/**
 * Sprint 6: profiles and privacy, social graph, posts, feed, notifications, reputation,
 * leaderboards and thesis evaluation, against real Postgres + Redis.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateDueTheses, type Quote } from "@suiem/reputation";
import { newId } from "@suiem/shared/ids";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { ROUTE_REGISTRY } from "../src/http/route";
import { reputationRuntime, type ReputationRuntime } from "../src/social/reputation.runtime";
import { Client, type Harness, signSiwe, startHarness } from "./harness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
type Json = Record<string, any>;

const clock = { now: () => new Date() };
const prices = new Map<string, string>([["SPY", "500"]]);
const quotes = async (ticker: string): Promise<Quote> => {
  const p = prices.get(ticker);
  if (!p) throw new Error(`no fixture quote for ${ticker}`);
  return { price: p, asOf: clock.now(), source: "fixture" };
};

let h: Harness;
let rep: ReputationRuntime;
let owner: pg.Client;
let entities: { id: string; canonical_id: string }[];
let simInstruments: string[];

beforeAll(async () => {
  h = await startHarness({
    clock,
    reputation: (db) => (rep = reputationRuntime(db, quotes, clock)),
  });
  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
  entities = (
    await owner.query<{ id: string; canonical_id: string }>(
      "SELECT id, canonical_id FROM entities WHERE kind = 'company' ORDER BY canonical_id LIMIT 8",
    )
  ).rows;
  simInstruments = (
    await owner.query<{ id: string }>(
      "SELECT id FROM instruments WHERE symbol LIKE 'SIM:%' AND entity_id IS NOT NULL ORDER BY symbol LIMIT 2",
    )
  ).rows.map((r) => r.id);
});

afterAll(async () => {
  for (const l of h?.logs ?? []) if (l.includes("unhandled error")) process.stderr.write(l);
  await owner?.end();
  await h?.close();
});

interface U {
  c: Client;
  id: string;
  handle: string;
  address: string;
}

async function user(): Promise<U> {
  const account = privateKeyToAccount(generatePrivateKey());
  const c = await new Client(h).init();
  const n = await c.request("POST", "/auth/siwe/nonce", { chainId: 46630 });
  const r = await c.request("POST", "/auth/siwe/verify", await signSiwe(account, n.json as never));
  expect(r.status).toBe(200);
  const me = (await c.request("GET", "/me")).json;
  return { c, id: me.id, handle: me.handle, address: account.address };
}

const req = (u: U, m: string, p: string, b?: unknown) => u.c.request(m, p, b);
const anon = () => new Client(h);
const post = async (u: U, body: Json) => {
  const r = await req(u, "POST", "/posts", body);
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as Json;
};
const follow = async (a: U, b: U) =>
  expect((await req(a, "POST", `/users/${b.id}/follow`)).status).toBe(200);
const setPrivacy = async (u: U, patch: Json) => {
  const r = await req(u, "PATCH", "/me/profile", patch);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
};

async function giveRealPositions(u: U) {
  for (const [i, inst] of simInstruments.entries())
    await owner.query(
      `INSERT INTO positions (id, user_id, instrument_id, book, quantity, quantity_decimals, cost_basis, cost_decimals)
       VALUES ($1, $2, $3, 'simulated', $4, 18, $5, 6)`,
      [newId(), u.id, inst, "2000000000000000000", i === 0 ? "60123456" : "39876544"],
    );
}

async function publicThesis(u: U, entityId = entities[0]!.canonical_id) {
  const t = await req(u, "POST", "/theses", {
    entityId,
    direction: "bullish",
    horizonDays: 30,
    title: "Data center demand keeps growing",
    rationale: "Accelerated computing demand is broadening across cloud providers and enterprises.",
    counterarguments: "Competition from custom chips may compress margins over time.",
    risks: "Customer capex could slow if AI monetisation disappoints investors.",
    invalidation: "Two consecutive quarters of declining data center revenue.",
  });
  expect(t.status).toBe(201);
  expect(
    (await req(u, "POST", `/theses/${t.json.id}/publish`, { visibility: "public" })).status,
  ).toBe(200);
  return t.json.id as string;
}

// ---------------------------------------------------------------------------------------------
describe("profiles and privacy (PRD §9.4)", () => {
  test("defaults: every field private, leaderboard off", async () => {
    const a = await user();
    const p = (await req(a, "GET", "/me/profile")).json;
    expect(p.privacy).toEqual({
      portfolioVisibility: "private",
      positionsVisibility: "private",
      transactionsVisibility: "private",
      thesesVisibility: "private",
      researchActivityVisibility: "private",
      followersVisibility: "private",
      walletVisibility: "private",
      appearInLeaderboards: false,
    });
    expect(p.handleChangeAvailable).toBe(true);
    expect(p.handle).toMatch(/^user_[0-9a-f]{8}$/);
  });

  test("each field is enforced per setting for strangers, followers, anonymous and the owner", async () => {
    const owner_ = await user();
    const fan = await user();
    const stranger = await user();
    await follow(fan, owner_);
    await giveRealPositions(owner_);
    await publicThesis(owner_);
    await owner.query(
      `INSERT INTO research_briefs (id, user_id, entity_id, schema_version, brief, model, prompt_version, data_freshness)
       VALUES ($1, $2, $3, 'brief.v1', '{}', 'm', 'p', 'fresh')`,
      [newId(), owner_.id, entities[1]!.id],
    );
    const fields: [
      string,
      (p: Json, research: Json, portfolio: { status: number; json: Json }) => unknown,
    ][] = [
      ["followersVisibility", (p) => p.followers],
      ["walletVisibility", (p) => p.wallets],
      ["thesesVisibility", (p) => p.theses],
      ["researchActivityVisibility", (_p, r) => r.activity],
      ["portfolioVisibility", (_p, _r, pf) => (pf.status === 200 ? pf.json.books : null)],
    ];
    for (const [field, pick] of fields) {
      for (const v of ["private", "followers", "public"] as const) {
        await setPrivacy(owner_, {
          [field]: v,
          ...(field === "walletVisibility" && v !== "private"
            ? { acknowledgeOnchainPublicity: true }
            : {}),
        });
        for (const [who, c, expected] of [
          ["owner", owner_.c, true],
          ["follower", fan.c, v !== "private"],
          ["stranger", stranger.c, v === "public"],
          ["anonymous", anon(), v === "public"],
        ] as const) {
          const p = (await c.request("GET", `/profiles/${owner_.handle}`)).json;
          const r = (await c.request("GET", `/profiles/${owner_.handle}/research`)).json;
          const pf = await c.request("GET", `/profiles/${owner_.handle}/portfolio`);
          const got = pick(p, r, pf);
          expect(got !== null && got !== undefined, `${field}=${v} as ${who}`).toBe(expected);
          if (field === "walletVisibility" && !expected)
            expect(JSON.stringify([p, r, pf.json]).toLowerCase()).not.toContain(
              owner_.address.slice(2).toLowerCase(),
            );
        }
      }
      // Back to private for the next field.
      await setPrivacy(owner_, { [field]: "private" });
    }
  });

  test("positions and transactions need their own setting; snapshot has percentages only", async () => {
    const a = await user();
    const b = await user();
    await giveRealPositions(a);
    await setPrivacy(a, { portfolioVisibility: "public" });
    let pf = (await req(b, "GET", `/profiles/${a.handle}/portfolio`)).json;
    expect(pf.label).toBe("Simulated / testnet performance, not live verified");
    expect(pf.books[0].label).toBe("Simulated");
    expect(pf.books[0].allocations.map((x: Json) => x.percent)).toEqual(["60.12", "39.88"]);
    expect(pf.books[0].allocations[0].heldSince).toBeUndefined();
    expect(pf.transactions).toBeNull();
    const raw = JSON.stringify(pf);
    for (const leak of ["60123456", "39876544", "2000000000000000000", "0x"])
      expect(raw).not.toContain(leak);
    const keys = (v: unknown): string[] =>
      v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
    for (const k of keys(pf)) expect(k).not.toMatch(/quantity|cost|amount|address|value|price/i);
    await setPrivacy(a, { positionsVisibility: "public", transactionsVisibility: "public" });
    pf = (await req(b, "GET", `/profiles/${a.handle}/portfolio`)).json;
    expect(pf.books[0].allocations[0]).toHaveProperty("heldSince");
    expect(pf.transactions).toEqual([]);
  });

  test("the wallet is never exposed by default, and enabling it needs the onchain caveat", async () => {
    const a = await user();
    const b = await user();
    await follow(b, a);
    const hex = a.address.slice(2).toLowerCase();
    for (const p of [
      `/profiles/${a.handle}`,
      `/profiles/${a.handle}/research`,
      "/feed?tab=following",
      "/feed?tab=discover",
      "/leaderboards/suiem?period=all",
    ])
      expect(JSON.stringify((await req(b, "GET", p)).json).toLowerCase()).not.toContain(hex);
    const r = await req(a, "PATCH", "/me/profile", { walletVisibility: "public" });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/onchain/);
    await setPrivacy(a, { walletVisibility: "followers", acknowledgeOnchainPublicity: true });
    expect(
      (await req(b, "GET", `/profiles/${a.handle}`)).json.wallets[0].address.toLowerCase(),
    ).toContain(hex);
  });

  test("portfolio posts in the feed follow the author's portfolio setting", async () => {
    const a = await user();
    const b = await user();
    await giveRealPositions(a);
    const p = await post(a, {
      kind: "portfolio_snapshot",
      body: "My allocation",
      visibility: "public",
    });
    expect(p.labels.simulatedTestnet).toBe(true);
    expect(JSON.stringify(p.attachment)).not.toContain("60123456");
    expect((await req(b, "GET", `/posts/${p.id}`)).status).toBe(404);
    expect(
      (await req(b, "GET", "/feed?tab=discover")).json.items.map((x: Json) => x.id),
    ).not.toContain(p.id);
    await setPrivacy(a, { portfolioVisibility: "public" });
    expect((await req(b, "GET", `/posts/${p.id}`)).status).toBe(200);
  });

  test("handle: changed once, validated and unique; display name optional", async () => {
    const a = await user();
    const b = await user();
    const handle = `h_${a.id.slice(-8)}`;
    expect((await req(a, "PATCH", "/me/profile", { handle: "Bad Handle!" })).status).toBe(400);
    expect((await req(a, "PATCH", "/me/profile", { handle: b.handle })).status).toBe(409);
    await setPrivacy(a, { handle, displayName: "Ada" });
    const again = await req(a, "PATCH", "/me/profile", { handle: `${handle}x` });
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/once/);
    expect((await anon().request("GET", `/profiles/${handle}`)).json.displayName).toBe("Ada");
  });
});

// ---------------------------------------------------------------------------------------------
describe("social graph, posts and feed", () => {
  test("block: the blocked user can't follow, comment on or react to the blocker", async () => {
    const a = await user();
    const b = await user();
    const p = await post(b, {
      kind: "discussion",
      body: "Thoughts on margins?",
      visibility: "public",
    });
    await follow(a, b);
    expect((await req(b, "POST", `/users/${a.id}/block`)).status).toBe(200);
    expect((await req(a, "POST", `/users/${b.id}/follow`)).status).toBe(403);
    expect((await req(a, "POST", `/posts/${p.id}/comments`, { body: "hi" })).status).toBe(404);
    expect((await req(a, "POST", `/posts/${p.id}/reactions`, { kind: "helpful" })).status).toBe(
      404,
    );
    expect((await req(a, "GET", `/profiles/${b.handle}`)).status).toBe(404);
    // Follows both ways were removed by the block.
    expect(
      (
        await owner.query("SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2", [
          a.id,
          b.id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  test("mute: the muted author disappears from the muter's feeds", async () => {
    const a = await user();
    const b = await user();
    await follow(a, b);
    const p = await post(b, {
      kind: "question",
      body: "Which metric matters most?",
      visibility: "public",
    });
    expect(
      (await req(a, "GET", "/feed?tab=following")).json.items.map((x: Json) => x.id),
    ).toContain(p.id);
    await req(a, "POST", `/users/${b.id}/mute`);
    for (const tab of ["following", "discover"])
      expect(
        (await req(a, "GET", `/feed?tab=${tab}`)).json.items.map((x: Json) => x.id),
      ).not.toContain(p.id);
    expect((await req(a, "GET", `/posts/${p.id}`)).status).toBe(200);
  });

  test("reactions: no self-reaction; helpful and not_helpful are exclusive; notifications", async () => {
    const a = await user();
    const b = await user();
    const p = await post(a, {
      kind: "learning_note",
      body: "How to read a 10-K",
      visibility: "public",
    });
    expect((await req(a, "POST", `/posts/${p.id}/reactions`, { kind: "helpful" })).status).toBe(
      403,
    );
    await req(b, "POST", `/posts/${p.id}/reactions`, { kind: "helpful" });
    await req(b, "POST", `/posts/${p.id}/reactions`, { kind: "not_helpful" });
    const v = (await req(b, "GET", `/posts/${p.id}`)).json.post;
    expect(v.counts).toMatchObject({ helpful: 0, notHelpful: 1 });
    expect(v.viewer.reaction).toBe("not_helpful");
    await req(b, "POST", `/posts/${p.id}/reactions`, { kind: "helpful" });
    expect((await req(b, "GET", `/posts/${p.id}`)).json.post.counts).toMatchObject({
      helpful: 1,
      notHelpful: 0,
    });
    await follow(b, a);
    const c1 = (await req(b, "POST", `/posts/${p.id}/comments`, { body: "Great note" })).json;
    await req(a, "POST", `/posts/${p.id}/comments`, { body: "Thanks!", parentId: c1.id });
    const n = (await req(a, "GET", "/notifications")).json;
    expect(n.items.map((x: Json) => x.kind).sort()).toEqual(["comment", "helpful", "new_follower"]);
    expect(n.unread).toBe(3);
    expect((await req(b, "GET", "/notifications")).json.items.map((x: Json) => x.kind)).toEqual([
      "reply",
    ]);
    await req(a, "POST", "/notifications/read");
    expect((await req(a, "GET", "/notifications")).json.unread).toBe(0);
    // Replies are one level deep.
    const reply = (await req(b, "GET", `/posts/${p.id}`)).json.comments.find(
      (c: Json) => c.parentId,
    );
    expect(
      (await req(b, "POST", `/posts/${p.id}/comments`, { body: "x", parentId: reply.id })).status,
    ).toBe(400);
  });

  test("soft delete hides a post everywhere", async () => {
    const a = await user();
    const b = await user();
    await follow(b, a);
    const p = await post(a, { kind: "discussion", body: "Temporary", visibility: "public" });
    await req(b, "POST", `/posts/${p.id}/bookmark`);
    expect((await req(b, "DELETE", `/posts/${p.id}`)).status).toBe(404); // not the author
    expect((await req(a, "DELETE", `/posts/${p.id}`)).status).toBe(200);
    expect((await req(b, "GET", `/posts/${p.id}`)).status).toBe(404);
    for (const path of [
      "/feed?tab=following",
      "/feed?tab=discover",
      "/bookmarks",
      `/profiles/${a.handle}/research`,
    ]) {
      const j = (await req(b, "GET", path)).json;
      expect(JSON.stringify(j), path).not.toContain(p.id);
    }
  });

  test("labels: thesis posts can't exceed the thesis visibility; brief posts are AI-assisted; visibility is required", async () => {
    const a = await user();
    const t = await req(a, "POST", "/theses", {
      entityId: entities[0]!.canonical_id,
      direction: "bearish",
      horizonDays: 7,
      title: "Valuation is stretched",
      rationale: "Multiple expansion outpaced earnings growth.",
      counterarguments: "Earnings may surprise to the upside.",
      risks: "Momentum could persist for longer than expected.",
      invalidation: "Forward P/E falls below its five-year average.",
    });
    expect(
      (await req(a, "POST", "/posts", { kind: "thesis", thesisId: t.json.id, body: "x" })).status,
    ).toBe(400);
    const tooWide = await req(a, "POST", "/posts", {
      kind: "thesis",
      thesisId: t.json.id,
      body: "x",
      visibility: "public",
    });
    expect(tooWide.status).toBe(400);
    const own = await post(a, {
      kind: "thesis",
      thesisId: t.json.id,
      body: "Shared privately",
      visibility: "private",
    });
    expect(own.labels).toEqual({
      sourced: false,
      aiAssisted: false,
      sponsored: false,
      simulatedTestnet: false,
    });
    const briefId = newId();
    await owner.query(
      `INSERT INTO research_briefs (id, user_id, entity_id, schema_version, brief, model, prompt_version, data_freshness)
       VALUES ($1, $2, $3, 'brief.v1', $4, 'm', 'p', 'fresh')`,
      [
        briefId,
        a.id,
        entities[0]!.id,
        JSON.stringify({
          entity: { canonicalId: entities[0]!.canonical_id, name: "Co" },
          summary: "Summary",
          sources: [{ title: "10-K", url: "https://www.sec.gov/x", publisher: "SEC" }],
          dataFreshness: "fresh",
        }),
      ],
    );
    const b = await post(a, {
      kind: "research_brief",
      briefId,
      body: "My take",
      visibility: "followers",
    });
    expect(b.labels).toMatchObject({ sourced: true, aiAssisted: true, sponsored: false });
    const other = await user();
    expect(
      (
        await req(other, "POST", "/posts", {
          kind: "research_brief",
          briefId,
          body: "steal",
          visibility: "public",
        })
      ).status,
    ).toBe(404);
  });

  test("cursor pagination is stable (Following keyset, Discover fixed asOf) with a diversity cap", async () => {
    const reader = await user();
    const authors = [await user(), await user(), await user()];
    for (const a of authors) await follow(reader, a);
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = newId();
      ids.push(id);
      await owner.query(
        "INSERT INTO posts (id, user_id, kind, body, visibility, created_at) VALUES ($1, $2, 'discussion', $3, 'public', now() - make_interval(mins => $4))",
        [id, authors[i % 3]!.id, `post ${i}`, i],
      );
    }
    const p1 = (await req(reader, "GET", "/feed?tab=following")).json;
    expect(p1.items).toHaveLength(20);
    await post(authors[0]!, { kind: "discussion", body: "brand new", visibility: "public" });
    const p2 = (await req(reader, "GET", `/feed?tab=following&cursor=${p1.nextCursor}`)).json;
    const seen = [...p1.items, ...p2.items].map((x: Json) => x.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((x) => ids.includes(x)).length).toBe(
      25 - 1 + (seen.includes(ids[24]!) ? 1 : 0),
    );
    expect(p2.items.map((x: Json) => x.body)).not.toContain("brand new");

    const d1 = (await req(reader, "GET", "/feed?tab=discover")).json;
    const perAuthor = new Map<string, number>();
    for (const it of d1.items) perAuthor.set(it.author.id, (perAuthor.get(it.author.id) ?? 0) + 1);
    for (const a of authors) expect(perAuthor.get(a.id) ?? 0).toBeLessThanOrEqual(2);
    const d2a = (await req(reader, "GET", `/feed?tab=discover&cursor=${d1.nextCursor}`)).json;
    await req(reader, "POST", `/posts/${d2a.items[0].id}/reactions`, { kind: "helpful" });
    const d2b = (await req(reader, "GET", `/feed?tab=discover&cursor=${d1.nextCursor}`)).json;
    expect(d2b.items.map((x: Json) => x.id)).toEqual(d2a.items.map((x: Json) => x.id));
  });

  test("scoping: A can't change B's profile, posts or comments", async () => {
    const a = await user();
    const b = await user();
    const p = await post(b, { kind: "discussion", body: "mine", visibility: "public" });
    const c = (await req(b, "POST", `/posts/${p.id}/comments`, { body: "mine too" })).json;
    expect((await req(a, "DELETE", `/posts/${p.id}`)).status).toBe(404);
    expect((await req(a, "DELETE", `/comments/${c.id}`)).status).toBe(404);
    await setPrivacy(a, { bio: "a's bio" });
    expect((await anon().request("GET", `/profiles/${b.handle}`)).json.bio).toBeNull();
    expect((await req(a, "PATCH", "/me/profile", { userId: b.id, bio: "x" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
describe("XSS: user content is stored and returned as plain text", () => {
  test("script, img onerror and javascript: payloads round-trip as inert JSON strings", async () => {
    const a = await user();
    const payloads = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "javascript:alert(1)",
    ];
    await setPrivacy(a, { bio: payloads.join(" "), displayName: "<b onmouseover=alert(1)>x</b>" });
    const p = await post(a, {
      kind: "discussion",
      body: payloads.join("\n"),
      visibility: "public",
    });
    const r = await anon().request("GET", `/posts/${p.id}`);
    expect(r.raw.headers["content-type"]).toMatch(/^application\/json/);
    expect(r.raw.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.json.post.body).toBe(payloads.join("\n"));
    const prof = (await anon().request("GET", `/profiles/${a.handle}`)).json;
    expect(prof.bio).toBe(payloads.join(" "));
    expect(prof.displayName).toBe("<b onmouseover=alert(1)>x</b>");
    expect((await req(a, "PATCH", "/me/profile", { bio: "a\u0000b" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
describe("no copy trading", () => {
  test("route scan: no social route reaches the order module", () => {
    const social = ROUTE_REGISTRY.filter((r) =>
      r.tags.some((t) =>
        ["profiles", "graph", "posts", "feed", "notifications", "reputation"].includes(t),
      ),
    );
    expect(social.length).toBeGreaterThan(20);
    for (const r of social) expect(r.path).not.toMatch(/order|trade|invest/i);
    const dir = join(import.meta.dirname, "../src/social");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(
        /orders\.service|OrdersService|from "\.\.\/orders|INSERT INTO (orders|fills|positions|ledger_entries)/,
      );
    }
  });

  test("following, viewing a portfolio and saving it never create an order", async () => {
    const a = await user();
    const b = await user();
    await giveRealPositions(a);
    await setPrivacy(a, { portfolioVisibility: "public" });
    await follow(b, a);
    await req(b, "GET", `/profiles/${a.handle}/portfolio`);
    const saved = await req(b, "POST", `/profiles/${a.handle}/portfolio/watchlist`);
    expect(saved.status).toBe(201);
    expect(saved.json.companies).toBe(2);
    const orders = await owner.query("SELECT 1 FROM orders WHERE user_id = $1", [b.id]);
    expect(orders.rowCount).toBe(0);
    const wl = (await req(b, "GET", "/watchlists")).json;
    expect(JSON.stringify(wl)).toContain("portfolio");
  });
});

// ---------------------------------------------------------------------------------------------
describe("device tokens get 403 on every Sprint 6 route", () => {
  test("all social, feed, notification, reputation and leaderboard routes", async () => {
    const u = await user();
    const code = (await u.c.request("POST", "/extension/pairing-codes", {})).json as Json;
    const pair = await h.app.inject({
      method: "POST",
      url: "/api/v1/extension/installations",
      headers: {
        "content-type": "application/json",
        origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      },
      payload: JSON.stringify({ pairingCode: code.code }),
    });
    const token = (pair.json() as Json).token as string;
    const routes = ROUTE_REGISTRY.filter((r) =>
      r.tags.some((t) =>
        ["profiles", "graph", "posts", "feed", "notifications", "reputation"].includes(t),
      ),
    );
    for (const r of routes) {
      const path = r.path
        .replace(":handle", u.handle)
        .replace(/:id/g, newId())
        .replace(":kind", "helpful")
        .replace(":board", "suiem");
      const res = await h.app.inject({
        method: r.method,
        url: `/api/v1${path}`,
        headers: {
          authorization: `Bearer ${token}`,
          origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
          ...(r.method === "GET" ? {} : { "content-type": "application/json" }),
        },
        payload: r.method === "GET" ? undefined : "{}",
      });
      expect(res.statusCode, `${r.method} ${r.path}`).toBe(403);
      expect((res.json() as Json).error.code).toBe("DEVICE_SCOPE");
    }
  });
});

// ---------------------------------------------------------------------------------------------
const DAY = 86_400_000;

/** Builds a rankable track record with real rows (5 evaluated decisions, 3 days, 3 raters). */
async function makeRanked(u: U, opts: { demo?: boolean } = {}) {
  if (opts.demo) await owner.query("UPDATE users SET is_demo = true WHERE id = $1", [u.id]);
  const t0 = Date.now() - 10 * DAY;
  for (let i = 0; i < 5; i++) {
    const thesis = newId();
    const at = new Date(t0 + i * DAY);
    await owner.query(
      `INSERT INTO theses (id, user_id, entity_id, visibility, status, published_at, created_at) VALUES ($1, $2, $3, 'public', 'published', $4, $4)`,
      [thesis, u.id, entities[i]!.id, at],
    );
    await owner.query(
      `INSERT INTO thesis_versions (id, thesis_id, version, direction, horizon_days, title, rationale, counterarguments, risks, invalidation, created_at)
       VALUES ($1, $2, 1, 'bullish', 1, $3, $4, 'Competition may compress margins over time.', 'Spending could slow if returns disappoint.', 'Revenue declines two quarters in a row.', $5)`,
      [
        newId(),
        thesis,
        `Thesis ${i} for ${u.handle}`,
        `Rationale ${i} ${u.id} ${"unique words ".repeat(5)}`,
        at,
      ],
    );
    await owner.query(
      `INSERT INTO thesis_evaluations (id, thesis_id, thesis_version, user_id, methodology, status, direction, horizon_days, window_start, window_end,
         benchmark_symbol, instrument_return_ppm, benchmark_return_ppm, relative_return_ppm, correct, evaluated_at)
       VALUES ($1, $2, 1, $3, 'v1-hackathon', 'evaluated', 'bullish', 1, $4, $5, 'SPY', 20000, 10000, 10000, $6, $5)`,
      [newId(), thesis, u.id, at, new Date(at.getTime() + DAY), i !== 4],
    );
  }
  const p = await post(u, { kind: "discussion", body: "Notes", visibility: "public" });
  for (let i = 0; i < 3; i++) {
    const r = await user();
    await owner.query("UPDATE users SET created_at = now() - interval '30 days' WHERE id = $1", [
      r.id,
    ]);
    const th = newId();
    await owner.query(
      "INSERT INTO theses (id, user_id, entity_id, visibility, status, published_at) VALUES ($1, $2, $3, 'public', 'published', now() - interval '20 days')",
      [th, r.id, entities[5]!.id],
    );
    expect((await req(r, "POST", `/posts/${p.id}/reactions`, { kind: "helpful" })).status).toBe(
      200,
    );
  }
  await rep.recompute(u.id);
  return p;
}

describe("reputation and leaderboards", () => {
  test("a new user is building: no score, progress shown, methodology and labels", async () => {
    const a = await user();
    const s = (await req(a, "GET", `/profiles/${a.handle}/reputation`)).json;
    expect(s.maturity).toBe("building");
    expect(s.suiemScore).toBeNull();
    expect(s.progress.decisions).toEqual({ have: 0, need: 5 });
    expect(s.badge).toBe("Hackathon season · limited history · preview");
    expect(s.methodologyVersion).toBe("v1-hackathon");
    // Others can't see a score unless the user opted in.
    expect((await anon().request("GET", `/profiles/${a.handle}/reputation`)).status).toBe(403);
    const db = await owner.query(
      "SELECT suiem_score FROM reputation_snapshots WHERE user_id = $1",
      [a.id],
    );
    expect(db.rows.every((r) => r.suiem_score === null)).toBe(true);
  });

  test("ranked profiles appear only when opted in; demo accounts only with the toggle", async () => {
    const a = await user();
    const d = await user();
    await makeRanked(a);
    await makeRanked(d, { demo: true });
    const s = (await req(a, "GET", `/profiles/${a.handle}/reputation`)).json;
    expect(s.maturity, JSON.stringify(s.progress)).toBe("ranked");
    expect(s.suiemScore).toMatch(/^\d+\.\d\d$/);
    expect(s.whatChanged.length).toBeGreaterThan(0);
    const handles = async (q = "") =>
      (await anon().request("GET", `/leaderboards/suiem?period=week${q}`)).json.rows.map(
        (r: Json) => r.handle,
      );
    expect(await handles()).not.toContain(a.handle);
    await setPrivacy(a, { appearInLeaderboards: true });
    await setPrivacy(d, { appearInLeaderboards: true });
    expect(await handles()).toContain(a.handle);
    expect(await handles()).not.toContain(d.handle);
    expect(await handles("&showDemo=true")).toContain(d.handle);
    const row = (await anon().request("GET", "/leaderboards/investors?period=all")).json;
    expect(row.label).toMatch(/simulated \/ testnet/);
    expect(row.rows.find((r: Json) => r.handle === a.handle)).toMatchObject({
      maturity: "ranked",
      methodologyVersion: "v1-hackathon",
    });
    // A building, opted-in profile never appears.
    const b = await user();
    await setPrivacy(b, { appearInLeaderboards: true });
    await rep.recompute(b.id);
    expect(await handles("&showDemo=true")).not.toContain(b.handle);
    expect((await anon().request("GET", "/leaderboards/nope")).status).toBe(404);
  });

  test("methodology is published; appeals are recorded", async () => {
    const m = (await anon().request("GET", "/reputation/methodology")).json;
    expect(m.active).toBe("v1-hackathon");
    expect(m.methodologies.map((x: Json) => x.version)).toEqual(["v1-hackathon", "v1"]);
    expect(m.integrity.join(" ")).toMatch(/\$WIF never affect/);
    const a = await user();
    expect((await req(a, "POST", "/reputation/appeals", { reason: "short" })).status).toBe(400);
    expect(
      (
        await req(a, "POST", "/reputation/appeals", {
          reason: "My evaluation used the wrong price",
        })
      ).status,
    ).toBe(201);
    expect(
      (await req(a, "POST", "/reputation/appeals", { reason: "Another appeal while open" })).status,
    ).toBe(409);
  });
});

// ---------------------------------------------------------------------------------------------
describe("thesis evaluation", () => {
  test("uses the frozen v1 even after edits; benchmark-relative; append-only; notifies", async () => {
    const a = await user();
    const id = (
      await req(a, "POST", "/theses", {
        entityId: entities[0]!.canonical_id,
        direction: "bullish",
        horizonDays: 1,
        title: "Short-term bullish call",
        rationale: "Upcoming product cycle.",
        counterarguments: "Supply constraints.",
        risks: "Macro weakness.",
        invalidation: "Guidance cut.",
      })
    ).json.id as string;
    // v1 was written two days ago with a price and an SPY mark.
    await owner.query("ALTER TABLE thesis_versions DISABLE TRIGGER thesis_versions_append_only");
    await owner.query(
      `UPDATE thesis_versions SET created_at = now() - interval '2 days',
         price_context = '{"symbol":"TSTA","price":"100","asOf":"2026-01-01T00:00:00Z","benchmark":{"symbol":"SPY","price":"500","asOf":"2026-01-01T00:00:00Z"}}'
       WHERE thesis_id = $1`,
      [id],
    );
    await owner.query("ALTER TABLE thesis_versions ENABLE TRIGGER thesis_versions_append_only");
    // v2 flips the direction: the evaluation must ignore it.
    expect(
      (
        await req(a, "PATCH", `/theses/${id}`, {
          direction: "bearish",
          horizonDays: 1,
          title: "Changed my mind",
          rationale: "x",
          counterarguments: "x",
          risks: "x",
          invalidation: "x",
        })
      ).status,
    ).toBe(200);
    prices.set("TSTA", "110"); // +10%
    prices.set("SPY", "505"); // +1%
    const deps = { ...rep.deps, now: () => new Date() };
    expect(await evaluateDueTheses(deps)).toBeGreaterThanOrEqual(1);
    const e = (await owner.query("SELECT * FROM thesis_evaluations WHERE thesis_id = $1", [id]))
      .rows;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      thesis_version: 1,
      direction: "bullish",
      status: "evaluated",
      correct: true,
      instrument_return_ppm: "100000",
      benchmark_return_ppm: "10000",
      relative_return_ppm: "90000",
    });
    await expect(
      owner.query("UPDATE thesis_evaluations SET correct = false WHERE thesis_id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await evaluateDueTheses(deps);
    expect(
      (await owner.query("SELECT 1 FROM thesis_evaluations WHERE thesis_id = $1", [id])).rowCount,
    ).toBe(1);
    expect(
      (
        await owner.query(
          "SELECT 1 FROM reputation_evidence WHERE user_id = $1 AND component = 'thesis_outcome'",
          [a.id],
        )
      ).rowCount,
    ).toBe(1);
    expect((await req(a, "GET", "/notifications")).json.items.map((n: Json) => n.kind)).toContain(
      "thesis_evaluated",
    );
  });
});
