import { afterAll, beforeAll, describe, expect, test } from "vitest";
import pg from "pg";
import { inject } from "vitest";
import { FlagsService } from "../src/flags/flags.service";
import { Client, type Harness, newWallet, signSiwe, startHarness, WEB_ORIGIN } from "./harness";
import { SoftAuthenticator } from "./soft-authenticator";

let h: Harness;
let owner: pg.Client;

beforeAll(async () => {
  h = await startHarness();
  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
});
afterAll(async () => {
  await owner.end();
  await h.close();
});

async function siweLogin(c: Client, chainId: 4663 | 46630, account = newWallet()) {
  const nonce = await c.request("POST", "/auth/siwe/nonce", { chainId });
  expect(nonce.status).toBe(200);
  const signed = await signSiwe(account, nonce.json as never);
  const r = await c.request("POST", "/auth/siwe/verify", signed);
  return { r, account, nonce: nonce.json };
}

async function passkeySignup(c: Client) {
  const auth = new SoftAuthenticator("localhost", WEB_ORIGIN);
  const opts = await c.request("POST", "/auth/passkey/register/options", {});
  expect(opts.status).toBe(200);
  const r = await c.request("POST", "/auth/passkey/register/verify", {
    response: auth.register(opts.json.options),
  });
  return { r, auth };
}

const CURRENT = "2026-11-10.1";
async function grantRequired(c: Client) {
  for (const purpose of ["terms", "privacy"]) {
    const r = await c.request("POST", "/me/consents", {
      purpose,
      action: "granted",
      policyVersion: CURRENT,
    });
    expect(r.status).toBe(201);
  }
}

describe("SIWE login (EIP-4361) on either chain", () => {
  for (const chainId of [4663, 46630] as const) {
    test(`signs up on first use and logs in again on chain ${chainId}`, async () => {
      const c = await new Client(h).init();
      const account = newWallet();
      const first = await siweLogin(c, chainId, account);
      expect(first.r.status).toBe(200);
      expect(first.r.json).toMatchObject({ isNewUser: true, authMethods: ["siwe"] });
      const me = await c.request("GET", "/me");
      expect(me.status).toBe(200);
      expect(me.json.wallets[0]).toMatchObject({ chainId, address: account.address });

      const c2 = await new Client(h).init();
      const again = await siweLogin(c2, chainId, account);
      expect(again.r.json).toMatchObject({ isNewUser: false, userId: first.r.json.userId });
    });
  }

  describe("rejections", () => {
    let c: Client;
    beforeAll(async () => {
      c = await new Client(h).init();
    });
    const fresh = async (chainId: 4663 | 46630 = 4663) =>
      (await c.request("POST", "/auth/siwe/nonce", { chainId })).json as never;

    test("unsupported chain in the nonce request (e.g. mainnet Ethereum 1)", async () => {
      const r = await c.request("POST", "/auth/siwe/nonce", { chainId: 1 });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("VALIDATION_FAILED");
    });

    test("wrong chain in the message (unsupported, or different from the nonce's chain)", async () => {
      for (const chainId of [1, 46630]) {
        const signed = await signSiwe(newWallet(), await fresh(4663), { chainId });
        const r = await c.request("POST", "/auth/siwe/verify", signed);
        expect(r.status).toBe(400);
        expect(r.json.error.code).toBe("SIWE_INVALID");
        expect(r.json.error.message).toMatch(/chain/);
      }
    });

    test("wrong domain", async () => {
      const r = await c.request(
        "POST",
        "/auth/siwe/verify",
        await signSiwe(newWallet(), await fresh(), { domain: "evil.example" }),
      );
      expect(r.json.error).toMatchObject({
        code: "SIWE_INVALID",
        message: expect.stringMatching(/domain/),
      });
    });

    test("wrong URI", async () => {
      const r = await c.request(
        "POST",
        "/auth/siwe/verify",
        await signSiwe(newWallet(), await fresh(), { uri: "https://evil.example" }),
      );
      expect(r.json.error.message).toMatch(/URI/);
    });

    test("expired message", async () => {
      const past = new Date(Date.now() - 10 * 60 * 1000);
      const r = await c.request(
        "POST",
        "/auth/siwe/verify",
        await signSiwe(newWallet(), await fresh(), {
          issuedAt: new Date(past.getTime() - 60_000),
          expirationTime: past,
        }),
      );
      expect(r.json.error.message).toMatch(/expired/);
    });

    test("replayed nonce (a valid message can be used exactly once)", async () => {
      const signed = await signSiwe(newWallet(), await fresh());
      expect((await c.request("POST", "/auth/siwe/verify", signed)).status).toBe(200);
      const replay = await new Client(h)
        .init()
        .then((c2) => c2.request("POST", "/auth/siwe/verify", signed));
      expect(replay.status).toBe(400);
      expect(replay.json.error.message).toMatch(/already used|unknown/);
    });

    test("signature from a different key", async () => {
      const n = await fresh();
      const { message } = await signSiwe(newWallet(), n);
      const { signature } = await signSiwe(newWallet(), n);
      const r = await c.request("POST", "/auth/siwe/verify", { message, signature });
      expect(r.json.error.message).toMatch(/signature/);
    });

    test("a login nonce cannot be used to link a wallet", async () => {
      const user = await new Client(h).init();
      await siweLogin(user, 4663);
      const loginNonce = (await user.request("POST", "/auth/siwe/nonce", { chainId: 4663 }))
        .json as never;
      const r = await user.request("POST", "/wallet/link", {
        ...(await signSiwe(newWallet(), loginNonce)),
        custodyAcknowledged: true,
      });
      expect(r.json.error.message).toMatch(/purpose/);
    });
  });
});

describe("passkey (WebAuthn)", () => {
  test("sign up, then log in with the passkey from a new browser", async () => {
    const c = await new Client(h).init();
    const { r, auth } = await passkeySignup(c);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ isNewUser: true, authMethods: ["passkey"] });

    const c2 = await new Client(h).init();
    const opts = await c2.request("POST", "/auth/passkey/login/options", {});
    const login = await c2.request("POST", "/auth/passkey/login/verify", {
      response: auth.authenticate(opts.json.options),
    });
    expect(login.status).toBe(200);
    expect(login.json.userId).toBe(r.json.userId);
    expect((await c2.request("GET", "/me")).json.passkeyCount).toBe(1);
  });

  test("a challenge can be used once; wrong origin is rejected", async () => {
    const c = await new Client(h).init();
    const auth = new SoftAuthenticator("localhost", WEB_ORIGIN);
    const opts = await c.request("POST", "/auth/passkey/register/options", {});
    const response = auth.register(opts.json.options);
    expect((await c.request("POST", "/auth/passkey/register/verify", { response })).status).toBe(
      200,
    );
    const replay = await c.request("POST", "/auth/passkey/register/verify", { response });
    expect(replay.json.error.code).toBe("PASSKEY_FAILED");

    const c3 = await new Client(h).init();
    const opts3 = await c3.request("POST", "/auth/passkey/register/options", {});
    const evil = new SoftAuthenticator("localhost", WEB_ORIGIN).register(opts3.json.options, {
      origin: "https://evil.example",
    });
    expect(
      (await c3.request("POST", "/auth/passkey/register/verify", { response: evil })).json.error
        .code,
    ).toBe("PASSKEY_FAILED");
  });

  test("a SIWE user can add a passkey to the same account", async () => {
    const c = await new Client(h).init();
    const { r } = await siweLogin(c, 46630);
    const auth = new SoftAuthenticator("localhost", WEB_ORIGIN);
    const opts = await c.request("POST", "/auth/passkey/register/options", {});
    const add = await c.request("POST", "/auth/passkey/register/verify", {
      response: auth.register(opts.json.options),
    });
    expect(add.json).toMatchObject({ userId: r.json.userId, isNewUser: false });
    expect((await c.request("GET", "/me")).json.authMethods.sort()).toEqual(["passkey", "siwe"]);
  });
});

describe("writes require CSRF and a session", () => {
  test("missing CSRF token, wrong token or foreign Origin are rejected", async () => {
    const c = await new Client(h).init();
    await siweLogin(c, 4663);
    for (const opts of [
      { csrf: null },
      { csrf: "wrong-token-wrong-token-wrong-token-xx" },
      { origin: "https://evil.example" },
      { origin: null },
    ]) {
      const r = await c.request("PATCH", "/me", { displayName: "x" }, opts);
      expect(r.status, JSON.stringify(opts)).toBe(403);
      expect(r.json.error.code).toBe("CSRF_FAILED");
    }
    expect((await c.request("PATCH", "/me", { displayName: "Ok" })).status).toBe(200);
  });

  test("auth endpoints need CSRF too (login CSRF)", async () => {
    const c = await new Client(h).init();
    const r = await c.request("POST", "/auth/siwe/nonce", { chainId: 4663 }, { csrf: null });
    expect(r.json.error.code).toBe("CSRF_FAILED");
  });

  test("valid CSRF but no session → 401 on user routes", async () => {
    const c = await new Client(h).init();
    for (const [m, p, b] of [
      ["PATCH", "/me", { displayName: "x" }],
      ["POST", "/me/consents", { purpose: "terms", action: "granted", policyVersion: CURRENT }],
      ["POST", "/wallet/nonce", { chainId: 4663 }],
    ] as const) {
      const r = await c.request(m, p, b);
      expect(r.status, p).toBe(401);
      expect(r.json.error.code).toBe("UNAUTHENTICATED");
    }
    expect((await c.request("GET", "/me")).status).toBe(401);
  });

  test("logout revokes the session server-side", async () => {
    const c = await new Client(h).init();
    await siweLogin(c, 4663);
    expect((await c.request("POST", "/auth/logout", {})).status).toBe(200);
    expect((await c.request("GET", "/me")).status).toBe(401);
  });
});

describe("consent and onboarding without a funded wallet", () => {
  test("passkey user (no wallet at all) accepts consent and finishes onboarding", async () => {
    const c = await new Client(h).init();
    const { r } = await passkeySignup(c);
    const early = await c.request("PATCH", "/me", { onboardingCompleted: true });
    expect(early.json.error.code).toBe("CONSENT_REQUIRED");

    await grantRequired(c);
    const rows = await owner.query(
      "SELECT purpose, policy_version, action, recorded_at FROM consent_records WHERE user_id = $1 ORDER BY purpose",
      [r.json.userId],
    );
    expect(rows.rows.map((x) => [x.purpose, x.policy_version, x.action])).toEqual([
      ["privacy", CURRENT, "granted"],
      ["terms", CURRENT, "granted"],
    ]);
    expect(rows.rows.every((x) => x.recorded_at instanceof Date)).toBe(true);

    const done = await c.request("PATCH", "/me", {
      interestsSkipped: true,
      experienceLevel: "beginner",
      jurisdiction: "IN",
      onboardingCompleted: true,
    });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({
      wallets: [],
      requiredConsentsGranted: true,
      interestsSkipped: true,
    });
    expect(done.json.onboardingCompletedAt).toBeTruthy();
  });

  test("consent must use the current policy version; required consent cannot be withdrawn", async () => {
    const c = await new Client(h).init();
    await siweLogin(c, 4663);
    expect(
      (
        await c.request("POST", "/me/consents", {
          purpose: "terms",
          action: "granted",
          policyVersion: "2020-01-01.1",
        })
      ).json.error.code,
    ).toBe("CONSENT_INVALID_TRANSITION");
    await grantRequired(c);
    expect(
      (
        await c.request("POST", "/me/consents", {
          purpose: "terms",
          action: "withdrawn",
          policyVersion: CURRENT,
        })
      ).json.error.code,
    ).toBe("CONSENT_REQUIRED");
    const list = await c.request("GET", "/me/consents");
    expect(list.json.items.find((i: { purpose: string }) => i.purpose === "terms")).toMatchObject({
      status: "granted",
      required: true,
    });
  });
});

describe("wallet linking", () => {
  test("links a second wallet on the other chain; cannot link a wallet owned by someone else", async () => {
    const c = await new Client(h).init();
    await siweLogin(c, 4663);
    const second = newWallet();
    const n = await c.request("POST", "/wallet/nonce", { chainId: 46630 });
    const link = await c.request("POST", "/wallet/link", {
      ...(await signSiwe(second, n.json as never)),
      custodyAcknowledged: true,
    });
    expect(link.status).toBe(201);
    expect(link.json).toMatchObject({ chainId: 46630, address: second.address });

    const other = await new Client(h).init();
    await siweLogin(other, 46630);
    const n2 = await other.request("POST", "/wallet/nonce", { chainId: 4663 });
    const steal = await other.request("POST", "/wallet/link", {
      ...(await signSiwe(second, n2.json as never)),
      custodyAcknowledged: true,
    });
    expect(steal.json.error.code).toBe("WALLET_ALREADY_LINKED");
  });

  test("custody acknowledgement is required", async () => {
    const c = await new Client(h).init();
    await siweLogin(c, 4663);
    const n = await c.request("POST", "/wallet/nonce", { chainId: 4663 });
    const r = await c.request("POST", "/wallet/link", await signSiwe(newWallet(), n.json as never));
    expect(r.json.error.code).toBe("VALIDATION_FAILED");
  });

  test("user A cannot unlink user B's wallet; the only login method cannot be removed", async () => {
    const a = await new Client(h).init();
    await siweLogin(a, 4663);
    const b = await new Client(h).init();
    await siweLogin(b, 4663);
    const bWallet = (await b.request("GET", "/wallet/links")).json.items[0].id;
    expect((await a.request("DELETE", `/wallet/link/${bWallet}`)).status).toBe(404);
    expect((await b.request("DELETE", `/wallet/link/${bWallet}`)).json.error.code).toBe("CONFLICT");
  });
});

describe("flags and jurisdiction", () => {
  test("trading.live cannot be enabled through the service, env or config", async () => {
    const flags = h.app.get(FlagsService);
    await expect(flags.set("trading.live", true)).rejects.toMatchObject({ code: "FLAG_LOCKED" });
    const cfg = await new Client(h).request("GET", "/config");
    expect(cfg.json.flags["trading.live"]).toBe(false);
    expect(cfg.json.chains.map((x: { id: number }) => x.id)).toEqual([4663, 46630]);
    const h2 = await startHarness({ envOverrides: { FLAG_ELECTIONS: "true" } });
    try {
      const flags2 = h2.app.get(FlagsService);
      expect(await flags2.all()).toMatchObject({ "trading.live": false, elections: true });
    } finally {
      await h2.close();
    }
  });

  test("Stock Token routes are blocked server-side for restricted or undeclared jurisdictions", async () => {
    const c = await new Client(h).init();
    await siweLogin(c, 46630);
    expect((await c.request("GET", "/invest/stock-tokens")).json.error.code).toBe("POLICY_DENIED");
    for (const j of ["US", "GB", "CA", "CH", "RU"]) {
      await c.request("PATCH", "/me", { jurisdiction: j });
      const r = await c.request("GET", "/invest/stock-tokens");
      expect(r.status, j).toBe(403);
      expect((await c.request("GET", "/invest/eligibility")).json).toMatchObject({
        eligible: false,
        reason: "restricted_jurisdiction",
      });
    }
    await c.request("PATCH", "/me", { jurisdiction: "IN" });
    const ok = await c.request("GET", "/invest/stock-tokens");
    expect(ok.status).toBe(200);
    expect(ok.json.items).toHaveLength(5);
    expect(
      ok.json.items.every(
        (i: { status: string; network: string }) =>
          i.status === "unverified" && i.network === "testnet",
      ),
    ).toBe(true);
  });
});

describe("API contract", () => {
  test("errors use the envelope with a request id; unknown routes are 404", async () => {
    const c = new Client(h);
    const r = await c.request("GET", "/does-not-exist");
    expect(r.status).toBe(404);
    expect(r.json.error).toMatchObject({ code: "NOT_FOUND", requestId: expect.any(String) });
    expect(r.raw.headers["x-request-id"]).toBe(r.json.error.requestId);
  });

  test("OpenAPI lists every route and has no order/transfer endpoints", async () => {
    const r = await new Client(h).request("GET", "/openapi.json");
    const paths = Object.keys(r.json.paths);
    for (const p of [
      "/api/v1/me",
      "/api/v1/me/consents",
      "/api/v1/auth/siwe/verify",
      "/api/v1/auth/passkey/login/verify",
      "/api/v1/wallet/link",
      "/api/v1/wallet/link/{id}",
    ]) {
      expect(paths).toContain(p);
    }
    expect(paths.some((p) => /order|transfer|vote|swap/.test(p))).toBe(false);
  });

  test("request logs carry no wallet addresses, cookies or tokens", async () => {
    const c = await new Client(h).init();
    const { account } = await siweLogin(c, 4663);
    await c.request("GET", "/me");
    const text = h.logs.join("");
    expect(text).not.toContain(account.address.slice(2, 12));
    expect(text).not.toMatch(/suiem_sid|suiem_csrf|0x[0-9a-fA-F]{40}/);
  });
});
