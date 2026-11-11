import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import pg from "pg";
import { Client, type Harness, newWallet, signSiwe, startHarness } from "./harness";

/** A mutable clock so pairing-code expiry can be tested without waiting. */
const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
let h: Harness;
let owner: pg.Client;

beforeAll(async () => {
  h = await startHarness({ clock });
  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
});
afterAll(async () => {
  await owner.end();
  await h.close();
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
  return { c, userId: r.json.userId as string };
}

/** Extension-style request: Bearer token, no cookies, extension origin. */
async function device(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
) {
  const headers: Record<string, string> = { origin };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await h.app.inject({
    method: method as "GET",
    url: `/api/v1${path}`,
    headers,
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
  return { status: res.statusCode, json: res.json() as Record<string, any> };
}

async function pairNew() {
  const { c, userId } = await signedIn();
  const code = (await c.request("POST", "/extension/pairing-codes", {})).json.code as string;
  const r = await device("POST", "/extension/installations", null, {
    pairingCode: code,
    label: "Test Chrome",
  });
  expect(r.status).toBe(201);
  return {
    c,
    userId,
    token: r.json.token as string,
    installationId: r.json.installationId as string,
    code,
  };
}

describe("extension origin check (EXTENSION_ID set)", () => {
  test("writes need the extension origin; GETs may omit Origin but a wrong one is rejected", async () => {
    const strict = await startHarness({
      envOverrides: { EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop" },
    });
    try {
      const c = await new Client(strict).init();
      const n = await c.request("POST", "/auth/siwe/nonce", { chainId: 46630 });
      await c.request("POST", "/auth/siwe/verify", await signSiwe(newWallet(), n.json as never));
      const code = (await c.request("POST", "/extension/pairing-codes", {})).json.code as string;
      const call = async (
        method: string,
        path: string,
        headers: Record<string, string>,
        body?: unknown,
      ) => {
        const r = await strict.app.inject({
          method: method as "GET",
          url: `/api/v1${path}`,
          headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
          payload: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.statusCode, json: r.json() as Record<string, unknown> };
      };
      expect(
        (
          await call(
            "POST",
            "/extension/installations",
            { origin: "https://evil.example" },
            { pairingCode: code },
          )
        ).status,
      ).toBe(403);
      expect(
        (await call("POST", "/extension/installations", {}, { pairingCode: code })).status,
      ).toBe(403);
      const ok = await call(
        "POST",
        "/extension/installations",
        { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
        { pairingCode: code },
      );
      expect(ok.status).toBe(201);
      const auth = { authorization: `Bearer ${ok.json.token as string}` };
      expect((await call("GET", "/extension/config", auth)).status).toBe(200);
      expect(
        (await call("GET", "/extension/config", { ...auth, origin: "https://evil.example" }))
          .status,
      ).toBe(403);
    } finally {
      await strict.close();
    }
  });
});

describe("pairing", () => {
  test("a pairing code works once, and only for 5 minutes", async () => {
    const { c, code, token } = await pairNew();
    expect(token).toMatch(/^sxt_[A-Za-z0-9_-]{43}$/);
    const again = await device("POST", "/extension/installations", null, { pairingCode: code });
    expect(again.json.error.code).toBe("PAIRING_INVALID");

    const code2 = (await c.request("POST", "/extension/pairing-codes", {})).json.code as string;
    clock.offsetMs = 5 * 60 * 1000 + 1000;
    try {
      const expired = await device("POST", "/extension/installations", null, {
        pairingCode: code2,
      });
      expect(expired.json.error.code).toBe("PAIRING_INVALID");
    } finally {
      clock.offsetMs = 0;
    }
  });

  test("codes and tokens are stored only as hashes", async () => {
    const { token, code, installationId } = await pairNew();
    const rows = await owner.query("SELECT token_hash FROM extension_installations WHERE id = $1", [
      installationId,
    ]);
    expect(Buffer.from(rows.rows[0].token_hash).toString("utf8")).not.toContain(token.slice(4, 20));
    const codes = await owner.query(
      "SELECT count(*)::int AS n FROM extension_pairing_codes WHERE code_hash::text LIKE $1",
      [`%${code}%`],
    );
    expect(codes.rows[0].n).toBe(0);
  });

  test("creating a pairing code needs a signed-in web session (with CSRF)", async () => {
    const c = await new Client(h).init();
    expect((await c.request("POST", "/extension/pairing-codes", {})).status).toBe(401);
  });
});

describe("device token scope", () => {
  let token: string;
  let installationId: string;
  let c: Client;
  beforeAll(async () => {
    ({ token, installationId, c } = await pairNew());
  });

  test("works on extension routes", async () => {
    const cfg = await device("GET", "/extension/config", token);
    expect(cfg.status).toBe(200);
    expect(cfg.json).toMatchObject({
      notifyThreshold: 0.8,
      rateLimits: { perEntityMinutes: 30, perDomainPerHour: 3 },
    });
    expect((await device("GET", "/entities/ent:nvidia", token)).json).toMatchObject({
      name: "NVIDIA",
      tickers: ["NVDA"],
    });
    expect((await device("GET", "/entities/search?q=pal", token)).json.items[0].canonicalId).toBe(
      "ent:palantir",
    );
  });

  test("is rejected with 403 on every non-extension route", async () => {
    for (const [m, p, b] of [
      ["GET", "/me", undefined],
      ["PATCH", "/me", { displayName: "x" }],
      ["GET", "/me/consents", undefined],
      ["POST", "/wallet/nonce", { chainId: 4663 }],
      ["GET", "/wallet/links", undefined],
      [
        "POST",
        "/wallet/link",
        { message: "x".repeat(60), signature: "0x00", custodyAcknowledged: true },
      ],
      ["GET", "/invest/stock-tokens", undefined],
      ["POST", "/extension/pairing-codes", {}],
      ["GET", "/extension/installations", undefined],
      ["POST", "/auth/logout", {}],
      ["GET", "/config", undefined],
      ["POST", "/research/briefs", { entityId: "ent:nvidia" }],
      ["GET", "/research/briefs", undefined],
      ["POST", "/research/compare", { entityIds: ["ent:nvidia", "ent:apple"] }],
      ["POST", "/research/theses/draft", { briefId: "00000000-0000-7000-8000-000000000000" }],
      ["GET", "/entities/ent:nvidia/quote", undefined],
      ["GET", "/watchlists", undefined],
      ["POST", "/watchlists", { name: "x" }],
      ["GET", "/theses", undefined],
      ["POST", "/theses", {}],
    ] as const) {
      const r = await device(m, p, token, b);
      expect(r.status, `${m} ${p}`).toBe(403);
      expect(r.json.error.code).toBe("DEVICE_SCOPE");
    }
  });

  test("an extension can only disconnect itself; a revoked token is rejected immediately", async () => {
    const other = await pairNew();
    expect(
      (await device("DELETE", `/extension/installations/${other.installationId}`, token)).json.error
        .code,
    ).toBe("DEVICE_SCOPE");
    const list = await c.request("GET", "/extension/installations");
    expect(list.json.items.map((i: { id: string }) => i.id)).toContain(installationId);
    expect((await c.request("DELETE", `/extension/installations/${installationId}`)).status).toBe(
      200,
    );
    const after = await device("GET", "/extension/config", token);
    expect(after.status).toBe(401);
    expect(
      (await c.request("GET", "/extension/installations")).json.items.map(
        (i: { id: string }) => i.id,
      ),
    ).not.toContain(installationId);
  });

  test("invalid tokens are rejected; device routes need a token", async () => {
    expect((await device("GET", "/extension/config", "sxt_" + "A".repeat(43))).status).toBe(401);
    expect((await device("GET", "/extension/config", null)).status).toBe(401);
  });
});

describe("research context and watchlist", () => {
  test("research-context requires userConfirmed and stores exactly the confirmed fields", async () => {
    const { token, userId } = await pairNew();
    const base = { entityId: "ent:nvidia", sourceUrl: "https://x.com/someone/status/123" };
    expect((await device("POST", "/extension/research-context", token, base)).json.error.code).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      (
        await device("POST", "/extension/research-context", token, {
          ...base,
          userConfirmed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await device("POST", "/extension/research-context", token, {
          ...base,
          userConfirmed: true,
          pageText: "x",
        })
      ).status,
    ).toBe(400);

    const ok = await device("POST", "/extension/research-context", token, {
      ...base,
      userConfirmed: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ status: "queued", hasExcerpt: false, entityId: "ent:nvidia" });
    expect(ok.json.researchUrl).toBe("http://localhost:3000/research/ent%3Anvidia");
    const withExcerpt = await device("POST", "/extension/research-context", token, {
      ...base,
      userConfirmed: true,
      selectedExcerpt: "Nvidia beat",
    });
    expect(withExcerpt.json.hasExcerpt).toBe(true);
    const rows = await owner.query(
      "SELECT source_url, excerpt, status FROM research_requests WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    expect(rows.rows).toEqual([
      { source_url: base.sourceUrl, excerpt: null, status: "queued" },
      { source_url: base.sourceUrl, excerpt: "Nvidia beat", status: "queued" },
    ]);
    expect(
      (
        await device("POST", "/extension/research-context", token, {
          ...base,
          entityId: "ent:nope",
          userConfirmed: true,
        })
      ).status,
    ).toBe(404);

    const del = await device("DELETE", "/extension/activity", token);
    expect(del.json.deleted).toBe(2);
  });

  test("watchlist add is idempotent per item and visible on the web", async () => {
    const { token, c } = await pairNew();
    const first = await device("POST", "/watchlists/default/items", token, {
      entityId: "ent:palantir",
    });
    expect(first.json).toMatchObject({
      created: true,
      item: { entityId: "ent:palantir", name: "Palantir" },
    });
    const second = await device("POST", "/watchlists/default/items", token, {
      entityId: "ent:palantir",
    });
    expect(second.json).toMatchObject({ created: false, item: { id: first.json.item.id } });
    const web = await c.request("GET", "/watchlists/default");
    expect(web.json.items).toHaveLength(1);
    expect(
      (await c.request("POST", "/watchlists/default/items", { entityId: "ent:nvidia" })).json
        .created,
    ).toBe(true);
  });

  test("instruments carry network and 'no value' labels; the extension has no order route", async () => {
    const { token } = await pairNew();
    const r = await device("GET", "/entities/ent:tesla/instruments", token);
    const bySymbol = Object.fromEntries(r.json.items.map((i: { symbol: string }) => [i.symbol, i]));
    expect(bySymbol["TEST:TSLA"]).toMatchObject({
      network: "testnet",
      chainId: 46630,
      status: "active",
      contractAddress: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
      label: "Testnet · no value",
    });
    expect(bySymbol["DEMO:TSLA"]).toMatchObject({
      network: "testnet",
      label: expect.stringMatching(/no value/),
    });
    expect(bySymbol["SIM:TSLA"]).toMatchObject({ network: "offchain", label: "Simulated" });
    expect(
      (
        await device("POST", "/orders/preview", token, {
          entityId: "ent:tesla",
          book: "testnet",
          side: "buy",
          amount: "1",
        })
      ).status,
    ).toBe(403);
  });

  test("web research page lists the user's queued requests", async () => {
    const { token, c } = await pairNew();
    await device("POST", "/extension/research-context", token, {
      entityId: "ent:amd",
      sourceUrl: "https://x.com/a/1",
      userConfirmed: true,
    });
    const r = await c.request("GET", "/research/requests?entityId=ent:amd");
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0]).toMatchObject({ status: "queued", entityId: "ent:amd" });
  });

  test("logs never contain excerpts, URL query strings or tokens", async () => {
    const { token } = await pairNew();
    await device("POST", "/extension/research-context", token, {
      entityId: "ent:nvidia",
      sourceUrl: "https://x.com/a/status/9?secretquery=1",
      selectedExcerpt: "very private excerpt",
      userConfirmed: true,
    });
    const text = h.logs.join("");
    expect(text).not.toContain("very private excerpt");
    expect(text).not.toContain("secretquery");
    expect(text).not.toContain(token.slice(4, 24));
  });
});
