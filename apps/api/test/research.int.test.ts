import { researchBriefV1, type ResearchBriefV1 } from "@suiem/shared/research";
import {
  EdgarProvider,
  FinnhubProvider,
  type GenerateInput,
  MemoryCache,
  MemoryQuota,
  ModelError,
  processRequest,
  type ResearchModel,
} from "@suiem/research";
import { fixtureFetcher, goodNarrative } from "@suiem/research/testing";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { pipelineDeps, type ResearchRuntime } from "../src/research/runtime";
import { Client, type Harness, newWallet, signSiwe, startHarness } from "./harness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
type Json = Record<string, any>;
type Reply = unknown | ModelError | ((input: GenerateInput) => unknown);

/** Scriptable models: each provider replies with `script[provider]` (default: a valid answer). */
const calls = { groq: [] as GenerateInput[], gemini: [] as GenerateInput[] };
const script: { groq: Reply[]; gemini: Reply[] } = { groq: [], gemini: [] };

function defaultReply(input: GenerateInput): unknown {
  if (input.schemaName === "answer")
    return {
      insufficientSources: false,
      claims: [
        {
          text: "NVIDIA reported revenue of USD 215.94 billion in FY2026.",
          kind: "fact",
          sourceIds: ["s1"],
        },
      ],
    };
  if (input.schemaName === "thesis_draft")
    return {
      title: "Data center demand drives NVIDIA",
      direction: "bullish",
      horizonDays: 365,
      rationale: "Demand for accelerated computing.",
      counterarguments: "Competition is rising.",
      risks: "Customer spending could slow.",
      invalidation: "Data center revenue declines for two quarters.",
      evidenceClaimIds: ["c1", "c999"],
    };
  return goodNarrative(["s1", "s3"]);
}

function scripted(provider: "groq" | "gemini", model: string): ResearchModel {
  return {
    provider,
    model,
    async generate(input) {
      calls[provider].push(input);
      const next = script[provider].length ? script[provider].shift() : undefined;
      const v =
        next === undefined
          ? defaultReply(input)
          : typeof next === "function"
            ? (next as (i: GenerateInput) => unknown)(input)
            : next;
      if (v instanceof ModelError) throw v;
      return { json: structuredClone(v), tokens: 700 };
    },
  };
}

let h: Harness;
let rt: ResearchRuntime;
let owner: pg.Client;

beforeAll(async () => {
  h = await startHarness({
    research: (db) => {
      const cache = new MemoryCache();
      const f = fixtureFetcher();
      rt = {
        filings: new EdgarProvider("Suiem tests test@example.com", cache, 3_600_000, {
          fetcher: f,
          minIntervalMs: 0,
        }),
        market: new FinnhubProvider("k".repeat(40), cache, 3_600_000, {
          fetcher: f,
          minIntervalMs: 0,
        }),
        models: [scripted("groq", "openai/gpt-oss-120b"), scripted("gemini", "gemini-3.5-flash")],
        quota: new MemoryQuota(),
        dailyLimit: 10,
        cacheTtlMs: 12 * 3_600_000,
        // Runs the job inline so tests can assert the result right after the request.
        enqueue: async (id) =>
          void (await processRequest(
            pipelineDeps(
              rt,
              db,
              () => new Date(),
              () => {},
            ),
            id,
          )),
      };
      return rt;
    },
  });
  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
});
afterAll(async () => {
  await owner.end();
  await h.close();
});
beforeEach(() => {
  script.groq = [];
  script.gemini = [];
  calls.groq = [];
  calls.gemini = [];
  rt.dailyLimit = 10;
  rt.cacheTtlMs = 12 * 3_600_000;
});

async function signedIn() {
  const c = await new Client(h).init();
  const n = await c.request("POST", "/auth/siwe/nonce", { chainId: 46630 });
  const r = await c.request(
    "POST",
    "/auth/siwe/verify",
    await signSiwe(newWallet(), n.json as never),
  );
  expect(r.status).toBe(200);
  return { c, userId: (r.json as Json).userId as string };
}
const req = async (c: Client, m: string, p: string, b?: unknown) => {
  const r = await c.request(m, p, b);
  return { status: r.status, json: r.json as Json };
};

async function device(method: string, path: string, token: string, body?: unknown) {
  const headers: Record<string, string> = {
    origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    authorization: `Bearer ${token}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await h.app.inject({
    method: method as "GET",
    url: `/api/v1${path}`,
    headers,
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.statusCode, json: res.json() as Json };
}
async function pair(c: Client) {
  const code = (await req(c, "POST", "/extension/pairing-codes", {})).json.code as string;
  const res = await h.app.inject({
    method: "POST",
    url: "/api/v1/extension/installations",
    headers: {
      "content-type": "application/json",
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    },
    payload: JSON.stringify({ pairingCode: code }),
  });
  return (res.json() as Json).token as string;
}

/** Requests a brief from the web and returns the completed request row. */
async function brief(c: Client, entityId: string) {
  const r = await req(c, "POST", "/research/briefs", { entityId });
  expect(r.status).toBe(202);
  const list = await req(c, "GET", `/research/requests?entityId=${entityId}`);
  return list.json.items.find((i: Json) => i.id === r.json.id) as Json;
}

describe("research pipeline (mocked models, recorded provider data)", () => {
  test("a valid brief is persisted with model, provider, prompt and schema versions, freshness and sources", async () => {
    const { c } = await signedIn();
    const done = await brief(c, "ent:nvidia");
    expect(done).toMatchObject({ status: "completed", source: "web", failureReason: null });
    expect(done.summary).toMatch(/NVIDIA/);
    expect(done.topRisks.length).toBe(2);
    const b = await req(c, "GET", `/research/briefs/${done.briefId}`);
    expect(b.status).toBe(200);
    expect(researchBriefV1.safeParse(b.json.brief).success).toBe(true);
    expect(b.json).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      promptVersion: "research.v1",
      schemaVersion: "brief.v1",
      dataFreshness: "fresh",
      cached: false,
    });
    const stored = b.json.brief as ResearchBriefV1;
    expect(stored.financialHighlights.find((f) => f.metric === "revenue")).toMatchObject({
      value: "215938000000",
      currency: "USD",
      basis: "reported",
      sourceIds: ["s1"],
    });
    const rows = await owner.query(
      "SELECT url, supports FROM brief_sources WHERE brief_id = $1 ORDER BY retrieved_at, url",
      [done.briefId],
    );
    expect(rows.rowCount).toBe(stored.sources.length);
    const s1 = rows.rows.find((r) => r.url === stored.sources[0]!.url);
    expect(s1.supports.length).toBeGreaterThanOrEqual(9);
    // The model never received a schema slot for figures: it writes narrative only.
    expect(JSON.stringify(calls.groq[0]!.schema)).not.toMatch(/financialHighlights|valuation/);
  });

  test("Groq 429 falls back to Gemini and the brief records Gemini", async () => {
    const { c } = await signedIn();
    rt.cacheTtlMs = 0;
    script.groq = [new ModelError("groq", "rate_limit", "429")];
    const done = await brief(c, "ent:nvidia");
    expect(done.status).toBe("completed");
    const b = await req(c, "GET", `/research/briefs/${done.briefId}`);
    expect(b.json).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash" });
    expect((b.json.brief as ResearchBriefV1).generation).toMatchObject({
      provider: "gemini",
      model: "gemini-3.5-flash",
    });
  });

  test("invalid output (forbidden phrase, unknown source) is retried, then the fallback is used", async () => {
    const { c } = await signedIn();
    rt.cacheTtlMs = 0;
    const bad1 = { ...goodNarrative(), summary: "NVIDIA is a guaranteed winner." };
    const bad2 = goodNarrative();
    bad2.risks[0]!.sourceIds = ["s99"];
    script.groq = [bad1, bad2];
    const done = await brief(c, "ent:nvidia");
    expect(done.status).toBe("completed");
    expect(calls.groq.length).toBe(2);
    expect(calls.groq[1]!.user).toMatch(/previous answer was rejected[\s\S]*forbidden/);
    expect((await req(c, "GET", `/research/briefs/${done.briefId}`)).json.provider).toBe("gemini");
  });

  test("both providers failing marks the request failed with a user-safe reason, and nothing is saved", async () => {
    const { c, userId } = await signedIn();
    rt.cacheTtlMs = 0;
    script.groq = [new ModelError("groq", "unavailable", "503")];
    script.gemini = [new ModelError("gemini", "timeout", "t")];
    const done = await brief(c, "ent:nvidia");
    expect(done).toMatchObject({ status: "failed", briefId: null });
    expect(done.failureReason).toMatch(/busy or at their free-tier limits/);
    const n = await owner.query(
      "SELECT count(*)::int AS n FROM research_briefs WHERE user_id = $1",
      [userId],
    );
    expect(n.rows[0].n).toBe(0);
  });

  test("an invented number in the summary fails validation on every provider: request failed", async () => {
    const { c } = await signedIn();
    rt.cacheTtlMs = 0;
    const invented = { ...goodNarrative(), summary: "NVIDIA controls 92% of the market." };
    script.groq = [invented, invented];
    script.gemini = [invented, invented];
    const done = await brief(c, "ent:nvidia");
    expect(done.status).toBe("failed");
    expect(done.failureReason).toMatch(/citation and safety checks/);
  });

  test("the daily quota is enforced with a clear message", async () => {
    const { c } = await signedIn();
    rt.cacheTtlMs = 0;
    rt.dailyLimit = 1;
    expect((await brief(c, "ent:nvidia")).status).toBe("completed");
    const second = await brief(c, "ent:nvidia");
    expect(second).toMatchObject({ status: "failed" });
    expect(second.failureReason).toMatch(/Daily research limit reached \(1 briefs per day\)/);
  });

  test("a public-data brief is reused from cache for another user, labelled with its generation time", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const first = await brief(a.c, "ent:apple");
    const before = calls.groq.length + calls.gemini.length;
    const second = await brief(b.c, "ent:apple");
    expect(calls.groq.length + calls.gemini.length).toBe(before); // no model call
    const ba = (await req(a.c, "GET", `/research/briefs/${first.briefId}`)).json;
    const bb = (await req(b.c, "GET", `/research/briefs/${second.briefId}`)).json;
    expect(second.briefId).not.toBe(first.briefId);
    expect(bb).toMatchObject({ cached: true, generatedAt: ba.generatedAt });
    expect((await req(a.c, "GET", `/research/briefs/${second.briefId}`)).status).toBe(404); // each user owns their copy
  });

  test("a request with an excerpt is never cached or reused, and the excerpt never reaches logs", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const token = await pair(a.c);
    const excerpt = "TSMC wafer pricing chatter zq-unique-excerpt-7731";
    const r = await device("POST", "/extension/research-context", token, {
      entityId: "ent:tsmc",
      sourceUrl: "https://x.com/a/1",
      selectedExcerpt: excerpt,
      userConfirmed: true,
    });
    expect(r.status).toBe(201);
    const withExcerpt = (await device("GET", "/research/requests?entityId=ent:tsmc", token)).json
      .items[0];
    expect(withExcerpt).toMatchObject({ status: "completed", hasExcerpt: true });
    expect(calls.groq.at(-1)!.user).toMatch(
      /NOT a source and must not be cited[\s\S]*zq-unique-excerpt-7731/,
    );
    const stored = await owner.query(
      "SELECT public_only, cached_from FROM research_briefs WHERE id = $1",
      [withExcerpt.briefId],
    );
    expect(stored.rows[0]).toMatchObject({ public_only: false, cached_from: null });
    // Another user's public request for the same entity generates fresh (does not reuse the excerpt brief).
    const n = calls.groq.length;
    const pub = await brief(b.c, "ent:tsmc");
    expect(calls.groq.length).toBe(n + 1);
    expect((await req(b.c, "GET", `/research/briefs/${pub.briefId}`)).json.cached).toBe(false);
    // And a second excerpt request does not reuse anything either.
    await device("POST", "/extension/research-context", token, {
      entityId: "ent:tsmc",
      sourceUrl: "https://x.com/a/2",
      selectedExcerpt: excerpt,
      userConfirmed: true,
    });
    expect(calls.groq.length).toBe(n + 2);
    expect(h.logs.join("\n")).not.toContain("zq-unique-excerpt-7731");
  });

  test("the TSMC brief is partial (foreign filer without XBRL) and says so", async () => {
    const { c } = await signedIn();
    rt.cacheTtlMs = 0;
    const done = await brief(c, "ent:tsmc");
    const b = (await req(c, "GET", `/research/briefs/${done.briefId}`)).json;
    expect(b.dataFreshness).toBe("partial");
    expect((b.brief as ResearchBriefV1).financialHighlights).toEqual([]);
    expect((b.brief as ResearchBriefV1).openQuestions[0]).toMatch(/Data not available/);
  });
});

describe("follow-ups, feedback, compare, quote, drafts", () => {
  let c: Client;
  let briefId: string;
  beforeAll(async () => {
    ({ c } = await signedIn());
    briefId = (await brief(c, "ent:nvidia")).briefId;
  });

  test("a follow-up question is answered only from the brief's source pack, with citations", async () => {
    const r = await req(c, "POST", `/research/briefs/${briefId}/questions`, {
      question: "What was revenue last year?",
    });
    expect(r.status).toBe(201);
    expect(r.json.claims).toEqual([
      { id: "q1", text: expect.stringMatching(/215.94 billion/), kind: "fact", sourceIds: ["s1"] },
    ]);
    const prompt = calls.groq.at(-1)!;
    expect(prompt.schemaName).toBe("answer");
    expect(prompt.user).toMatch(/cite only these IDs: s1, s2/);
    expect(JSON.stringify(prompt.schema)).toMatch(/"enum":\["s1","s2"/);
    expect((await req(c, "GET", `/research/briefs/${briefId}`)).json.questions).toHaveLength(1);
  });

  test("an answer citing a source outside the pack is rejected (502 after fallback)", async () => {
    const bad = {
      insufficientSources: false,
      claims: [{ text: "Made up.", kind: "fact", sourceIds: ["s42"] }],
    };
    script.groq = [bad, bad];
    script.gemini = [bad, bad];
    const r = await req(c, "POST", `/research/briefs/${briefId}/questions`, {
      question: "Anything new?",
    });
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe("RESEARCH_FAILED");
  });

  test("feedback is stored and shown back to the user", async () => {
    expect(
      (
        await req(c, "POST", `/research/briefs/${briefId}/feedback`, {
          kind: "outdated",
          note: "News is a week old",
        })
      ).status,
    ).toBe(201);
    expect(
      (await req(c, "POST", `/research/briefs/${briefId}/feedback`, { kind: "wrong" })).status,
    ).toBe(400);
    expect((await req(c, "GET", `/research/briefs/${briefId}`)).json.myFeedback).toEqual([
      expect.objectContaining({ kind: "outdated", note: "News is a week old" }),
    ]);
  });

  test("compare builds a deterministic table with sources, no AI", async () => {
    const before = calls.groq.length + calls.gemini.length;
    const r = await req(c, "POST", "/research/compare", {
      entityIds: ["ent:nvidia", "ent:apple", "ent:tsmc"],
    });
    expect(r.status).toBe(200);
    expect(calls.groq.length + calls.gemini.length).toBe(before);
    const revenue = r.json.rows.find((x: Json) => x.metric === "revenue");
    expect(revenue.cells.map((x: Json) => x.value)).toEqual(["215938000000", "478834000000", null]);
    expect(revenue.cells[0]).toMatchObject({
      currency: "USD",
      basis: "reported",
      sourceLabel: "SEC EDGAR 0001045810-26-000021",
    });
    expect(revenue.cells[0].sourceUrl).toMatch(
      /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1045810\//,
    );
    expect(r.json.entities[2].dataNotes.join(" ")).toMatch(/No US-GAAP XBRL/);
    expect((await req(c, "POST", "/research/compare", { entityIds: ["ent:nvidia"] })).status).toBe(
      400,
    );
  });

  test("quote carries timestamp and source", async () => {
    const r = await req(c, "GET", "/entities/ent:nvidia/quote");
    expect(r.json).toMatchObject({
      symbol: "NVDA",
      currency: "USD",
      price: "168.89",
      source: "Finnhub (free tier)",
      asOf: new Date(1794344400 * 1000).toISOString(),
    });
    expect((await req(c, "GET", "/entities/ent:bitcoin/quote")).status).toBe(404);
  });

  test("an AI thesis draft is returned for editing and never saved", async () => {
    const before = (await owner.query("SELECT count(*)::int AS n FROM theses")).rows[0].n;
    const r = await req(c, "POST", "/research/theses/draft", { briefId });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ aiDraft: true, saved: false, direction: "bullish" });
    expect(r.json.evidence.map((e: Json) => e.claimId)).toEqual(["c1"]); // unknown claim ids dropped
    expect((await owner.query("SELECT count(*)::int AS n FROM theses")).rows[0].n).toBe(before);
  });
});

describe("theses", () => {
  const content = {
    direction: "bullish",
    horizonDays: 365,
    title: "Data center demand holds up",
    rationale: "Hyperscaler spending stays strong.",
    evidence: [] as Json[],
    counterarguments: "Custom chips compete.",
    risks: "Export rules.",
    invalidation: "Two quarters of falling data center revenue.",
  };

  test("create → private draft v1 with price context; edits append versions; v1 stays frozen", async () => {
    const { c } = await signedIn();
    const b = await brief(c, "ent:nvidia");
    const created = await req(c, "POST", "/theses", {
      ...content,
      entityId: "ent:nvidia",
      evidence: [{ briefId: b.briefId, claimId: "c1" }],
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      visibility: "private",
      status: "draft",
      currentVersion: 1,
    });
    const v1 = created.json.versions[0];
    expect(v1.priceContext).toMatchObject({
      symbol: "NVDA",
      price: "168.89",
      currency: "USD",
      source: "Finnhub (free tier)",
    });
    expect(v1.evidence[0]).toMatchObject({
      claimId: "c1",
      text: expect.stringMatching(/^Revenue was USD 215.94 billion/),
    });
    const edited = await req(c, "PATCH", `/theses/${created.json.id}`, {
      ...content,
      title: "Data center demand holds up (revised)",
    });
    expect(edited.json.currentVersion).toBe(2);
    expect(edited.json.versions.map((v: Json) => v.title)).toEqual([
      content.title,
      "Data center demand holds up (revised)",
    ]);
    expect(edited.json.versions[0]).toEqual(v1);
  });

  test("thesis versions are append-only in the database (UPDATE and DELETE rejected)", async () => {
    const { c } = await signedIn();
    const t = await req(c, "POST", "/theses", { ...content, entityId: "ent:apple" });
    await expect(
      owner.query("UPDATE thesis_versions SET title = 'rewritten' WHERE thesis_id = $1", [
        t.json.id,
      ]),
    ).rejects.toThrow();
    await expect(
      owner.query("DELETE FROM thesis_versions WHERE thesis_id = $1", [t.json.id]),
    ).rejects.toThrow();
    const r = await req(c, "POST", `/theses/${t.json.id}/review`, {
      outcome: "too_early",
      note: "Check again next quarter",
    });
    expect(r.status).toBe(201);
    expect(r.json.reviews).toHaveLength(1);
    expect(r.json.versions[0].title).toBe(content.title);
    await expect(
      owner.query("UPDATE thesis_reviews SET note = 'x' WHERE thesis_id = $1", [t.json.id]),
    ).rejects.toThrow();
  });

  test("nothing is public by default; publish is explicit and controls who can read", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const t = await req(a.c, "POST", "/theses", { ...content, entityId: "ent:nvidia" });
    expect((await req(b.c, "GET", `/theses/${t.json.id}`)).status).toBe(404);
    const p = await req(a.c, "POST", `/theses/${t.json.id}/publish`, { visibility: "public" });
    expect(p.json).toMatchObject({ visibility: "public", status: "published" });
    expect(p.json.publishedAt).toBeTruthy();
    const seen = await req(b.c, "GET", `/theses/${t.json.id}`);
    expect(seen.status).toBe(200);
    expect(seen.json.owner.isMe).toBe(false);
    expect((await req(b.c, "PATCH", `/theses/${t.json.id}`, content)).status).toBe(404);
    await req(a.c, "POST", `/theses/${t.json.id}/publish`, { visibility: "private" });
    expect((await req(b.c, "GET", `/theses/${t.json.id}`)).status).toBe(404);
  });

  test("evidence must come from the user's own briefs", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const other = await brief(b.c, "ent:nvidia");
    const r = await req(a.c, "POST", "/theses", {
      ...content,
      entityId: "ent:nvidia",
      evidence: [{ briefId: other.briefId, claimId: "c1" }],
    });
    expect(r.status).toBe(400);
  });
});

describe("scoping", () => {
  test("user B cannot read or act on user A's briefs, theses or watchlists", async () => {
    const a = await signedIn();
    const b = await signedIn();
    const done = await brief(a.c, "ent:nvidia");
    const thesis = await req(a.c, "POST", "/theses", {
      direction: "neutral",
      horizonDays: 90,
      title: "Watching",
      rationale: "r",
      counterarguments: "c",
      risks: "r",
      invalidation: "i",
      entityId: "ent:nvidia",
    });
    const list = await req(a.c, "POST", "/watchlists", { name: "Chips" });
    const item = await req(a.c, "POST", `/watchlists/${list.json.id}/items`, {
      entityId: "ent:nvidia",
    });
    for (const [m, p, body] of [
      ["GET", `/research/briefs/${done.briefId}`, undefined],
      ["POST", `/research/briefs/${done.briefId}/questions`, { question: "What is revenue?" }],
      ["POST", `/research/briefs/${done.briefId}/feedback`, { kind: "helpful" }],
      ["POST", "/research/theses/draft", { briefId: done.briefId }],
      ["GET", `/theses/${thesis.json.id}`, undefined],
      [
        "PATCH",
        `/theses/${thesis.json.id}`,
        {
          direction: "neutral",
          horizonDays: 90,
          title: "Hijack",
          rationale: "r",
          counterarguments: "c",
          risks: "r",
          invalidation: "i",
        },
      ],
      ["POST", `/theses/${thesis.json.id}/publish`, { visibility: "public" }],
      ["POST", `/watchlists/${list.json.id}/items`, { entityId: "ent:apple" }],
      ["PATCH", `/watchlists/${list.json.id}/items/${item.json.item.id}`, { note: "x" }],
      ["DELETE", `/watchlists/${list.json.id}/items/${item.json.item.id}`, undefined],
    ] as const) {
      expect((await req(b.c, m, p, body)).status, `${m} ${p}`).toBe(404);
    }
    expect(
      (await req(b.c, "GET", "/research/briefs")).json.items.map((x: Json) => x.id),
    ).not.toContain(done.briefId);
    expect((await req(b.c, "GET", "/watchlists")).json.items).toEqual([]);
    expect((await req(b.c, "GET", "/research/requests")).json.items).toEqual([]);
  });

  test("the device token reads request status (side panel) but nothing else of research", async () => {
    const { c } = await signedIn();
    const token = await pair(c);
    await device("POST", "/extension/research-context", token, {
      entityId: "ent:nvidia",
      sourceUrl: "https://x.com/a/9",
      userConfirmed: true,
    });
    const r = await device("GET", "/research/requests", token);
    expect(r.status).toBe(200);
    expect(r.json.items[0]).toMatchObject({ status: "completed", summary: expect.any(String) });
    expect(r.json.items[0].topRisks.length).toBeGreaterThan(0);
    for (const [m, p] of [
      ["GET", `/research/briefs/${r.json.items[0].briefId}`],
      ["GET", "/theses"],
      [
        "PATCH",
        "/watchlists/00000000-0000-7000-8000-000000000000/items/00000000-0000-7000-8000-000000000000",
      ],
    ] as const) {
      const x = await device(m, p, token, m === "PATCH" ? { note: "x" } : undefined);
      expect(x.status, `${m} ${p}`).toBe(403);
      expect(x.json.error.code).toBe("DEVICE_SCOPE");
    }
  });
});

describe("watchlists", () => {
  test("multiple lists, notes, thesis links, delete; names are unique per user", async () => {
    const { c } = await signedIn();
    const list = await req(c, "POST", "/watchlists", { name: "Semis" });
    expect(list.status).toBe(201);
    expect((await req(c, "POST", "/watchlists", { name: "Semis" })).status).toBe(409);
    const added = await req(c, "POST", `/watchlists/${list.json.id}/items`, {
      entityId: "ent:nvidia",
      note: "Watch margins",
    });
    expect(added.json).toMatchObject({
      created: true,
      item: { entityId: "ent:nvidia", note: "Watch margins", ticker: "NVDA" },
    });
    expect(
      (await req(c, "POST", `/watchlists/${list.json.id}/items`, { entityId: "ent:nvidia" })).json
        .created,
    ).toBe(false);
    const t = await req(c, "POST", "/theses", {
      direction: "neutral",
      horizonDays: 90,
      title: "Margins",
      rationale: "r",
      counterarguments: "c",
      risks: "r",
      invalidation: "i",
      entityId: "ent:nvidia",
    });
    const patched = await req(
      c,
      "PATCH",
      `/watchlists/${list.json.id}/items/${added.json.item.id}`,
      { note: "Margins + China", thesisId: t.json.id },
    );
    expect(patched.json.item).toMatchObject({ note: "Margins + China", thesisId: t.json.id });
    await req(c, "POST", "/watchlists/default/items", { entityId: "ent:apple" });
    const all = await req(c, "GET", "/watchlists");
    expect(all.json.items.map((w: Json) => w.name).sort()).toEqual(["Default", "Semis"]);
    expect(
      (await req(c, "DELETE", `/watchlists/${list.json.id}/items/${added.json.item.id}`)).status,
    ).toBe(204);
    expect(
      (await req(c, "GET", "/watchlists")).json.items.find((w: Json) => w.name === "Semis").items,
    ).toEqual([]);
  });
});
