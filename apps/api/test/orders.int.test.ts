/* eslint-disable no-restricted-imports -- the test plays the user's wallet: it must sign and send transactions on a local anvil (chain 46630) */
import { createSuiemPublicClient } from "@suiem/chain";
import { demoUSDAbi, suiemDemoVenueAbi } from "@suiem/chain/abi";
import { loadDemoDeployment } from "@suiem/chain/deployment";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import pg from "pg";
import { type Chain, createWalletClient, defineChain, type Hex, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import type { InvestRuntime } from "../src/orders/runtime";
import { Client, type Harness, signSiwe, startHarness } from "./harness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
type Json = Record<string, any>;
const ROOT = join(import.meta.dirname, "..", "..", "..");
const ANVIL_DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil's public dev key #0
const PRICES: Record<string, string> = { TSLA: "250", AMZN: "200", NVDA: "168.89" };

const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
let anvil: ChildProcess;
let rpc: string;
let h: Harness;
let owner: pg.Client;
let rt: InvestRuntime;
let chain: Chain;
let manifestPath: string;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

beforeAll(async () => {
  const port = await freePort();
  rpc = `http://127.0.0.1:${port}`;
  anvil = spawn("anvil", ["--port", String(port), "--chain-id", "46630", "--silent"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(rpc, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      headers: { "content-type": "application/json" },
    }).then(
      () => true,
      () => false,
    );
    if (ok) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const manifest = `deployments/anvil-it-${port}.json`;
  const signerKey = generatePrivateKey();
  execFileSync("npx", ["tsx", "scripts/deploy-testnet.ts", "--rpc", rpc, "--out", manifest], {
    cwd: ROOT,
    stdio: "ignore",
    env: {
      ...process.env,
      TESTNET_DEPLOYER_PRIVATE_KEY: ANVIL_DEPLOYER,
      QUOTE_SIGNER_PRIVATE_KEY: signerKey,
    },
  });
  manifestPath = join(ROOT, "packages", "contracts", manifest);
  const deployment = loadDemoDeployment(manifestPath)!;
  chain = defineChain({
    id: 46630,
    name: "anvil-46630",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });

  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
  // Point the demo instruments at this anvil deployment (what the seed does with deployments/46630.json).
  for (const [ticker, address] of Object.entries(deployment.tokens)) {
    await owner.query(
      "UPDATE instruments SET contract_address = $1, status = 'active', source_url = $2, last_verified_at = now() WHERE symbol = $3",
      [Buffer.from(address.slice(2), "hex"), `${rpc}/address/${address}`, `DEMO:${ticker}`],
    );
  }
  rt = {
    testnet: createSuiemPublicClient({ chainId: 46630, rpcUrl: rpc, timeoutMs: 10_000 }),
    deployment,
    quoteSignerKey: signerKey,
    price: async (t) => {
      if (!PRICES[t]) throw new Error("no quote");
      return {
        price: PRICES[t]!,
        at: new Date(clock.now().getTime() - 1000),
        source: "test quotes",
        sourceUrl: "https://example.test/quote",
      };
    },
    limits: {
      perOrderUsd: 1000n,
      perDayUsd: 5000n,
      demoFeeBps: 10,
      simFeeBps: 10,
      simSlippageBps: 5,
      slippageBps: 50,
    },
  };
  h = await startHarness({ clock, invest: rt, envOverrides: { FLAG_TRADING_TESTNET: "true" } });
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await h?.close();
  anvil?.kill();
  if (manifestPath) rmSync(manifestPath, { force: true });
});

async function user(country: string | null = "IN") {
  const account = privateKeyToAccount(generatePrivateKey());
  const c = await new Client(h).init();
  const n = await c.request("POST", "/auth/siwe/nonce", { chainId: 46630 });
  const r = await c.request("POST", "/auth/siwe/verify", await signSiwe(account, n.json as never));
  expect(r.status).toBe(200);
  if (country)
    expect((await c.request("PATCH", "/me", { jurisdiction: country })).status).toBe(200);
  await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_setBalance",
      params: [account.address, "0x8AC7230489E80000"],
    }),
  });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  return { c, account, wallet };
}
type User = Awaited<ReturnType<typeof user>>;

/** Requests through the logged-in client, with an optional Idempotency-Key. */
async function api(u: User, m: string, p: string, b?: unknown, key?: string) {
  if (!key) {
    const r = await u.c.request(m, p, b);
    return { status: r.status, json: r.json as Json };
  }
  const inner = u.c as unknown as { cookieHeader(): string; csrf: string };
  const res = await h.app.inject({
    method: m as "POST",
    url: `/api/v1${p}`,
    headers: {
      cookie: inner.cookieHeader(),
      "x-csrf-token": inner.csrf,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "idempotency-key": key,
    },
    payload: JSON.stringify(b),
  });
  return { status: res.statusCode, json: res.json() as Json };
}

const send = (u: User, to: string, data: string, gas?: bigint) =>
  u.wallet.sendTransaction({ to: to as Hex, data: data as Hex, ...(gas ? { gas } : {}) });
const key = () => `k_${crypto.randomUUID().replace(/-/g, "")}`;

async function claimDusd(u: User) {
  const hash = await u.wallet.writeContract({
    address: rt.deployment!.dusd,
    abi: demoUSDAbi,
    functionName: "claim",
  });
  await rt.testnet!.waitForTransactionReceipt({ hash });
}

/** Full user flow: preview → exact approve → confirm → sign → report → server reconcile. */
async function buy(u: User, amount: string, entityId = "ent:tesla") {
  const p = await api(u, "POST", "/orders/preview", {
    entityId,
    book: "testnet",
    side: "buy",
    amount,
  });
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  if (p.json.approval?.needed)
    await rt.testnet!.waitForTransactionReceipt({
      hash: await send(u, p.json.approval.token, p.json.approval.data),
    });
  const c = await api(
    u,
    "POST",
    "/orders",
    { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
    key(),
  );
  expect(c.json.status).toBe("pending");
  const hash = await send(u, p.json.tx.to, p.json.tx.data);
  await rt.testnet!.waitForTransactionReceipt({ hash });
  const s = await api(u, "POST", `/orders/${p.json.orderId}/transactions`, { txHash: hash });
  return { preview: p.json, order: s.json, hash, status: s.status };
}

describe("testnet demo venue: full flow against anvil (chain 46630)", () => {
  let a: User;
  beforeAll(async () => {
    a = await user();
    await claimDusd(a);
  });

  test("preview shows every field, an exact approval and the binding hash", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "buy",
      amount: "100",
    });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({
      book: "testnet",
      bookLabel: "Testnet demo · no value",
      instrument: {
        symbol: "DEMO:TSLA",
        network: "testnet",
        chainId: 46630,
        legalTypeLabel: expect.stringMatching(/no value · not a security/),
      },
      amountIn: { value: "100", asset: "dUSD" },
      estimatedOut: { value: "0.3996", asset: "dTSLA" },
      minOut: { value: "0.397602", asset: "dTSLA" },
      fee: { value: "0.1", asset: "dUSD", bps: 10 },
      price: { value: "250", currency: "USD", source: "test quotes" },
      route: { venue: rt.deployment!.venue },
      approval: { needed: true, amount: "100", spender: rt.deployment!.venue },
      tx: { chainId: 46630, to: rt.deployment!.venue, value: "0" },
      simulation: { ran: false },
    });
    expect(p.json.previewHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.json.checks.map((c: Json) => c.name)).toEqual([
      "Feature flag",
      "Jurisdiction",
      "Instrument",
      "Limits",
      "Venue",
      "Balance",
    ]);
    expect(new Date(p.json.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
  });

  test("buy → server reconcile → position; duplicate reports are no-ops", async () => {
    const r = await buy(a, "100");
    expect(r.order).toMatchObject({
      status: "filled",
      filledOut: { value: "0.3996", asset: "dTSLA" },
      txHash: r.hash,
    });
    const again = await api(a, "POST", `/orders/${r.preview.orderId}/transactions`, {
      txHash: r.hash,
    });
    expect(again.json.status).toBe("filled");
    const counts = await owner.query(
      "SELECT (SELECT count(*) FROM fills WHERE order_id = $1)::int AS f, (SELECT count(*) FROM ledger_entries WHERE order_id = $1)::int AS l",
      [r.preview.orderId],
    );
    expect(counts.rows[0]).toEqual({ f: 1, l: 3 });
    const port = await api(a, "GET", "/portfolio");
    const pos = port.json.books.testnet.positions[0];
    expect(pos).toMatchObject({
      instrumentSymbol: "DEMO:TSLA",
      quantity: "0.3996",
      costBasis: { value: "100", currency: "dUSD" },
      averageCost: { value: "250.25025", currency: "dUSD" },
    });
    expect(pos.marketValue.value).toBe("99.9");
    expect(pos.unrealizedPnl.value).toBe("-0.1");
  });

  test("sell (no approval; eth_call simulation runs) realizes P&L with average cost", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.1998",
    });
    expect(p.json).toMatchObject({
      approval: null,
      simulation: { ran: true, ok: true },
      estimatedOut: { asset: "dUSD" },
    });
    await api(
      a,
      "POST",
      "/orders",
      { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
      key(),
    );
    const hash = await send(a, p.json.tx.to, p.json.tx.data);
    await rt.testnet!.waitForTransactionReceipt({ hash });
    const s = await api(a, "POST", `/orders/${p.json.orderId}/transactions`, { txHash: hash });
    expect(s.json.status).toBe("filled");
    const pos = (await api(a, "GET", "/portfolio")).json.books.testnet.positions[0];
    // sold half: gross 49.95, fee 0.04995 → 49.90005 received; cost removed 50
    expect(pos).toMatchObject({ quantity: "0.1998", costBasis: { value: "50" } });
    expect(pos.realizedPnl.value).toBe("-0.09995"); // 49.90005 received − 50 cost removed
  });

  test("Idempotency-Key: required; same request replays; reuse with a different body is rejected", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "buy",
      amount: "1",
    });
    const body = { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true };
    expect((await api(a, "POST", "/orders", body)).json.error.code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    const k = key();
    const first = await api(a, "POST", "/orders", body, k);
    const second = await api(a, "POST", "/orders", body, k);
    expect(first.status).toBe(201);
    expect(second.json.id).toBe(first.json.id);
    const p2 = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "buy",
      amount: "2",
    });
    expect(
      (
        await api(
          a,
          "POST",
          "/orders",
          { orderId: p2.json.orderId, previewHash: p2.json.previewHash, acknowledged: true },
          k,
        )
      ).json.error.code,
    ).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  test("an unknown tx hash is not stored (no squatting); unexpired previews count toward the daily limit", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.01",
    });
    await api(
      a,
      "POST",
      "/orders",
      { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
      key(),
    );
    const ghost = `0x${"ab".repeat(32)}`;
    const r = await api(a, "POST", `/orders/${p.json.orderId}/transactions`, { txHash: ghost });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/not visible/);
    expect(
      (
        await owner.query("SELECT count(*)::int AS n FROM orders WHERE tx_hash = $1", [
          Buffer.from("ab".repeat(32), "hex"),
        ])
      ).rows[0].n,
    ).toBe(0);
    // Daily limit: previews alone (never confirmed) reserve budget until they expire.
    const u = await user();
    await claimDusd(u);
    const old = rt.limits.perDayUsd;
    rt.limits.perDayUsd = 25n;
    try {
      expect(
        (
          await api(u, "POST", "/orders/preview", {
            entityId: "ent:tesla",
            book: "testnet",
            side: "buy",
            amount: "20",
          })
        ).status,
      ).toBe(200);
      const second = await api(u, "POST", "/orders/preview", {
        entityId: "ent:tesla",
        book: "testnet",
        side: "buy",
        amount: "10",
      });
      expect(second.status).toBe(400);
      expect(second.json.error.message).toMatch(/Daily limit/);
    } finally {
      rt.limits.perDayUsd = old;
    }
  });

  test("a confirmation without acknowledgement, or with a different preview hash, is rejected", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "buy",
      amount: "1",
    });
    expect(
      (
        await api(
          a,
          "POST",
          "/orders",
          { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: false },
          key(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api(
          a,
          "POST",
          "/orders",
          { orderId: p.json.orderId, previewHash: `0x${"0".repeat(64)}`, acknowledged: true },
          key(),
        )
      ).status,
    ).toBe(409);
  });

  test("tampered transactions are rejected (amount, target, sender: Banchor R-1 regression)", async () => {
    // Two previews; the user tries to submit the tx of the OTHER (different amount) against order 1.
    const p1 = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.01",
    });
    const p2 = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.02",
    });
    await api(
      a,
      "POST",
      "/orders",
      { orderId: p1.json.orderId, previewHash: p1.json.previewHash, acknowledged: true },
      key(),
    );
    const other = await send(a, p2.json.tx.to, p2.json.tx.data);
    await rt.testnet!.waitForTransactionReceipt({ hash: other });
    const r = await api(a, "POST", `/orders/${p1.json.orderId}/transactions`, { txHash: other });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/does not match the previewed order/);
    // Same calldata but sent to a different contract (the dUSD token) is also rejected.
    const wrongTarget = await send(a, rt.deployment!.dusd, p1.json.tx.data, 200_000n);
    await rt.testnet!.waitForTransactionReceipt({ hash: wrongTarget });
    expect(
      (await api(a, "POST", `/orders/${p1.json.orderId}/transactions`, { txHash: wrongTarget }))
        .status,
    ).toBe(409);
    // Someone else sending the exact calldata: wrong sender.
    const b = await user();
    const stolen = await send(b, p1.json.tx.to, p1.json.tx.data, 300_000n);
    await rt.testnet!.waitForTransactionReceipt({ hash: stolen });
    expect(
      (await api(a, "POST", `/orders/${p1.json.orderId}/transactions`, { txHash: stolen })).status,
    ).toBe(409);
    expect((await api(a, "GET", `/orders/${p1.json.orderId}`)).json.status).toBe("pending");
  });

  test("a reverted transaction marks the order failed (venue paused onchain)", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.01",
    });
    await api(
      a,
      "POST",
      "/orders",
      { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
      key(),
    );
    const admin = createWalletClient({
      account: privateKeyToAccount(ANVIL_DEPLOYER),
      chain,
      transport: http(rpc),
    });
    await rt.testnet!.waitForTransactionReceipt({
      hash: await admin.writeContract({
        address: rt.deployment!.venue,
        abi: suiemDemoVenueAbi,
        functionName: "pause",
      }),
    });
    const hash = await send(a, p.json.tx.to, p.json.tx.data, 300_000n);
    await rt.testnet!.waitForTransactionReceipt({ hash });
    const r = await api(a, "POST", `/orders/${p.json.orderId}/transactions`, { txHash: hash });
    expect(r.json).toMatchObject({
      status: "failed",
      failureReason: expect.stringMatching(/reverted/),
    });
    // While paused, previews refuse.
    expect(
      (
        await api(a, "POST", "/orders/preview", {
          entityId: "ent:tesla",
          book: "testnet",
          side: "sell",
          amount: "0.01",
        })
      ).json.error.message,
    ).toMatch(/paused/);
    await rt.testnet!.waitForTransactionReceipt({
      hash: await admin.writeContract({
        address: rt.deployment!.venue,
        abi: suiemDemoVenueAbi,
        functionName: "unpause",
      }),
    });
  });

  test("an expired quote cannot be confirmed, and an unsent order expires", async () => {
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.01",
    });
    clock.offsetMs = 61_000;
    try {
      const r = await api(
        a,
        "POST",
        "/orders",
        { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
        key(),
      );
      expect(r.json.error.message).toMatch(/expired/);
      expect((await api(a, "GET", `/orders/${p.json.orderId}`)).json.status).toBe("expired");
    } finally {
      clock.offsetMs = 0;
    }
    const p2 = await api(a, "POST", "/orders/preview", {
      entityId: "ent:tesla",
      book: "testnet",
      side: "sell",
      amount: "0.01",
    });
    await api(
      a,
      "POST",
      "/orders",
      { orderId: p2.json.orderId, previewHash: p2.json.previewHash, acknowledged: true },
      key(),
    );
    clock.offsetMs = 120_000;
    try {
      expect((await api(a, "GET", `/orders/${p2.json.orderId}`)).json.status).toBe("expired");
    } finally {
      clock.offsetMs = 0;
    }
  });

  test("order events form a timeline; portfolio transactions link the explorer; CSV export", async () => {
    const tx = (await api(a, "GET", "/portfolio/transactions")).json.items.find(
      (o: Json) => o.status === "filled",
    );
    expect(tx.explorerUrl).toBe(`https://explorer.testnet.chain.robinhood.com/tx/${tx.txHash}`);
    const ev = await api(a, "GET", `/orders/${tx.id}/events`);
    expect(ev.json.items.map((e: Json) => e.status)).toEqual([
      "previewed",
      "pending",
      "submitted",
      "filled",
    ]);
    const inner = a.c as unknown as { cookieHeader(): string };
    const csv = await h.app.inject({
      method: "GET",
      url: "/api/v1/portfolio/export",
      headers: { cookie: inner.cookieHeader() },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body.split("\n")[0]).toMatch(/^created_at,book,side,status,symbol/);
    expect(csv.body).toContain("Testnet demo · no value");
  });

  test("history snapshots are per book", async () => {
    const r = await api(a, "GET", "/portfolio/history");
    expect(r.json.books.testnet.length).toBeGreaterThan(1);
    expect(Object.keys(r.json.books).sort()).toEqual(["simulated", "testnet"]);
  });
});

describe("simulated book", () => {
  test("paper buy fills at the quote with disclosed slippage and fee; books are never summed", async () => {
    const u = await user(null); // no country needed for paper trading
    const p = await api(u, "POST", "/orders/preview", {
      entityId: "ent:nvidia",
      book: "simulated",
      side: "buy",
      amount: "100",
    });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({
      book: "simulated",
      bookLabel: "Simulated",
      tx: null,
      approval: null,
      price: { value: "168.89", executionPrice: "168.974445" },
    });
    const c = await api(
      u,
      "POST",
      "/orders",
      { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
      key(),
    );
    expect(c.json.status).toBe("filled");
    const port = (await api(u, "GET", "/portfolio")).json;
    expect(Object.keys(port).sort()).toEqual(["books", "methodology"]); // no combined total anywhere
    expect(Object.keys(port.books).sort()).toEqual(["faucet", "simulated", "testnet"]);
    expect(port.books.simulated.positions[0]).toMatchObject({
      instrumentSymbol: "SIM:NVDA",
      costBasis: { value: "100", currency: "USD" },
    });
    expect(port.books.testnet.positions).toEqual([]);
    expect(port.methodology).toMatch(/Average cost/);
    // Selling more than held is refused.
    expect(
      (
        await api(u, "POST", "/orders/preview", {
          entityId: "ent:nvidia",
          book: "simulated",
          side: "sell",
          amount: "5",
        })
      ).status,
    ).toBe(400);
  });
});

describe("gates and scoping", () => {
  test("restricted and undeclared jurisdictions are blocked from Stock Token routes", async () => {
    for (const country of ["US", null]) {
      const u = await user(country);
      const r = await api(u, "POST", "/orders/preview", {
        entityId: "ent:tesla",
        book: "testnet",
        side: "buy",
        amount: "1",
      });
      expect(r.status).toBe(403);
      expect(r.json.error.message).toMatch(
        country ? /not available in your declared country/ : /Declare your country/,
      );
      expect((await api(u, "GET", "/portfolio/testnet-holdings")).json).toMatchObject({
        items: [],
        note: expect.stringMatching(/country/),
      });
    }
  });

  test("an unverified instrument gets no ticket", async () => {
    const u = await user();
    await owner.query("UPDATE instruments SET status = 'unverified' WHERE symbol = 'DEMO:AMZN'");
    try {
      const r = await api(u, "POST", "/orders/preview", {
        entityId: "ent:amazon",
        book: "testnet",
        side: "buy",
        amount: "1",
      });
      expect(r.status).toBe(403);
      expect(r.json.error.message).toMatch(/not deployed or not verified/);
    } finally {
      await owner.query("UPDATE instruments SET status = 'active' WHERE symbol = 'DEMO:AMZN'");
    }
  });

  test("trading.live stays impossible (schema and database)", async () => {
    const u = await user();
    expect(
      (
        await api(u, "POST", "/orders/preview", {
          entityId: "ent:tesla",
          book: "live",
          side: "buy",
          amount: "1",
        })
      ).status,
    ).toBe(400);
    await expect(
      owner.query("UPDATE feature_flags SET enabled = true WHERE key = 'trading.live'"),
    ).rejects.toThrow();
    await expect(
      owner.query(
        "INSERT INTO positions (id, user_id, instrument_id, book, quantity, quantity_decimals, cost_basis, cost_decimals) SELECT id, id, (SELECT id FROM instruments LIMIT 1), 'live', 0, 18, 0, 6 FROM users LIMIT 1",
      ),
    ).rejects.toThrow();
  });

  test("user B cannot see A's orders or portfolio", async () => {
    const a = await user();
    const b = await user();
    const p = await api(a, "POST", "/orders/preview", {
      entityId: "ent:nvidia",
      book: "simulated",
      side: "buy",
      amount: "10",
    });
    await api(
      a,
      "POST",
      "/orders",
      { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
      key(),
    );
    expect((await api(b, "GET", `/orders/${p.json.orderId}`)).status).toBe(404);
    expect((await api(b, "GET", `/orders/${p.json.orderId}/events`)).status).toBe(404);
    expect(
      (
        await api(
          b,
          "POST",
          "/orders",
          { orderId: p.json.orderId, previewHash: p.json.previewHash, acknowledged: true },
          key(),
        )
      ).status,
    ).toBe(404);
    expect((await api(b, "GET", "/portfolio")).json.books.simulated.positions).toEqual([]);
    expect((await api(b, "GET", "/portfolio/transactions")).json.items).toEqual([]);
  });

  test("a device token gets 403 on every order and portfolio route", async () => {
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
    const id = "00000000-0000-7000-8000-000000000000";
    for (const [m, p, b] of [
      [
        "POST",
        "/orders/preview",
        { entityId: "ent:tesla", book: "testnet", side: "buy", amount: "1" },
      ],
      ["POST", "/orders", { orderId: id, previewHash: `0x${"0".repeat(64)}`, acknowledged: true }],
      ["POST", `/orders/${id}/transactions`, { txHash: `0x${"0".repeat(64)}` }],
      ["GET", `/orders/${id}`, undefined],
      ["GET", `/orders/${id}/events`, undefined],
      ["GET", "/portfolio", undefined],
      ["GET", "/portfolio/transactions", undefined],
      ["GET", "/portfolio/history", undefined],
      ["GET", "/portfolio/testnet-holdings", undefined],
      ["GET", "/portfolio/export", undefined],
    ] as const) {
      const res = await h.app.inject({
        method: m,
        url: `/api/v1${p}`,
        headers: {
          authorization: `Bearer ${token}`,
          origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
          ...(b ? { "content-type": "application/json" } : {}),
        },
        payload: b ? JSON.stringify(b) : undefined,
      });
      expect(res.statusCode, `${m} ${p}`).toBe(403);
      expect((res.json() as Json).error.code).toBe("DEVICE_SCOPE");
    }
  });
});
