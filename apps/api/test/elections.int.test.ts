/* eslint-disable no-restricted-imports -- the test plays the voter's and owner's wallets: it signs and sends transactions on a LOCAL anvil (chain id 4663, no fork, nothing leaves this machine) */
/**
 * $WIF elections end to end against a local anvil reporting chain 4663, with a burnable
 * mock installed at the real $WIF address. Covers the candidate snapshot (fallback, labels,
 * exclusions, freeze), the indexer (idempotency, finality, simulated reorg, chunk halving,
 * cross-check), the API (preview, binding, privacy, scoping, device 403) and the reputation
 * separation (votes leave every reputation_* row byte-identical).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createSuiemPublicClient } from "@suiem/chain";
import { assertWifIdentity, type ElectionsDeployment } from "@suiem/chain/elections";
import { encodeCreateElection, encodeFinalize } from "@suiem/chain/write";
import { robinhoodMainnet, WIF } from "@suiem/config/chains";
import { ElectionsIndexer, type Heads } from "@suiem/indexer";
import { newId } from "@suiem/shared/ids";
import pg from "pg";
import { createWalletClient, type Hex, http, type PublicClient, parseAbi, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { snapshotCandidates } from "../src/elections/candidates";
import { insertDraft, markCreated } from "../src/elections/create";
import { Client, type Harness, signSiwe, startHarness } from "./harness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
type Json = Record<string, any>;
const ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT = join(ROOT, "packages", "contracts", "out");
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil dev key #0
const ownerAccount = privateKeyToAccount(OWNER_KEY);
const ONE = 10n ** 18n;
const mockAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
const fin = { safe: 0n, finalized: 0n };
let anvil: ChildProcess;
let rpc: string;
let client: PublicClient;
let h: Harness;
let owner: pg.Client;
let contract: Hex;
let deployBlock: bigint;
let indexer: ElectionsIndexer;
let entityId: string;
const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
const call = async (method: string, params: unknown[] = []) => {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return ((await r.json()) as { result: unknown }).result;
};
const chain = { ...robinhoodMainnet, rpcUrls: { default: { http: [] as string[] } } };
const walletOf = (key: Hex) =>
  createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(rpc) });
const mine = async (secondsAhead = 0) => {
  if (secondsAhead) await call("evm_increaseTime", [secondsAhead]);
  await call("evm_mine");
};
const heads = async (): Promise<Heads> => {
  const b = await client.getBlock({ blockTag: "latest" });
  const cap = (n: bigint) => (n < b.number ? n : b.number);
  return {
    latest: b.number,
    safe: cap(fin.safe),
    finalized: cap(fin.finalized),
    timestamp: b.timestamp,
  };
};
const newIndexer = (c: PublicClient = client, logRange = 5000) =>
  new ElectionsIndexer({
    pool: h.db.pool,
    client: c,
    chainId: 4663,
    contract,
    deployBlock,
    logRange,
    heads,
    log: (level, event, fields) => logs.push({ level, event, fields }),
  });

beforeAll(async () => {
  const port = await freePort();
  rpc = `http://127.0.0.1:${port}`;
  anvil = spawn("anvil", ["--port", String(port), "--chain-id", "4663", "--silent"], {
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    if (
      await call("eth_chainId").then(
        () => true,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // The burnable mock at the REAL $WIF address (so every hard-coded constant is exercised).
  const mock = JSON.parse(readFileSync(join(OUT, "LocalWIF.sol", "LocalWIF.json"), "utf8"));
  await call("anvil_setCode", [WIF.address, mock.deployedBytecode.object]);
  client = createSuiemPublicClient({ chainId: 4663, rpcUrl: rpc, maxRps: 0 });
  const art = JSON.parse(
    readFileSync(join(OUT, "SuiemElections.sol", "SuiemElections.json"), "utf8"),
  );
  const ow = walletOf(OWNER_KEY);
  const hash = await ow.deployContract({
    abi: art.abi,
    bytecode: art.bytecode.object,
    args: [ownerAccount.address, WIF.address],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  contract = getAddress(receipt.contractAddress!) as Hex;
  deployBlock = receipt.blockNumber;
  const deployment: ElectionsDeployment = {
    chainId: 4663,
    elections: contract,
    wif: WIF.address,
    owner: ownerAccount.address,
    deployer: ownerAccount.address,
    block: Number(deployBlock),
    transactions: [
      { contract: "SuiemElections", address: contract, hash, block: Number(deployBlock) },
    ],
    constructorArgs: [ownerAccount.address, WIF.address],
    sourceHash: "0x",
    gitSha: "test",
    compiler: "solc 0.8.30",
    deployedAt: new Date().toISOString(),
    explorer: "https://robinhoodchain.blockscout.com",
  };
  h = await startHarness({ clock, elections: { client, deployment } });
  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
  entityId = (
    await owner.query<{ id: string }>("SELECT id FROM entities WHERE kind = 'company' LIMIT 1")
  ).rows[0]!.id;
  indexer = newIndexer();
}, 60_000);

afterAll(async () => {
  for (const l of h?.logs ?? []) if (l.includes("unhandled error")) process.stderr.write(l);
  await owner?.end();
  await h?.close();
  anvil?.kill();
});

interface U {
  c: Client;
  id: string;
  handle: string;
  key: Hex;
  address: Hex;
}
async function user(): Promise<U> {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const c = await new Client(h).init();
  const n = await c.request("POST", "/auth/siwe/nonce", { chainId: 4663 });
  const r = await c.request("POST", "/auth/siwe/verify", await signSiwe(account, n.json as never));
  expect(r.status).toBe(200);
  const me = (await c.request("GET", "/me")).json;
  return { c, id: me.id, handle: me.handle, key, address: account.address };
}
/** Opted-in user with one public published thesis this week (Research fallback eligible). */
async function researcher(opts: { demo?: boolean; optIn?: boolean } = {}) {
  const u = await user();
  await owner.query("UPDATE profiles SET appear_in_leaderboards = $2 WHERE user_id = $1", [
    u.id,
    opts.optIn ?? true,
  ]);
  if (opts.demo) await owner.query("UPDATE users SET is_demo = true WHERE id = $1", [u.id]);
  await owner.query(
    "INSERT INTO theses (id, user_id, entity_id, visibility, status, published_at) VALUES ($1, $2, $3, 'public', 'published', now() - interval '1 day')",
    [newId(), u.id, entityId],
  );
  return u;
}
async function api(
  u: U | null,
  m: string,
  p: string,
  b?: unknown,
  headers: Record<string, string> = {},
) {
  const c = u?.c ?? new Client(h);
  const inner = c as unknown as { cookieHeader(): string; csrf: string };
  const res = await h.app.inject({
    method: m as "POST",
    url: `/api/v1${p}`,
    headers: {
      cookie: inner.cookieHeader(),
      ...(m === "GET"
        ? {}
        : {
            "x-csrf-token": inner.csrf,
            origin: "http://localhost:3000",
            "content-type": "application/json",
          }),
      ...headers,
    },
    payload: b === undefined ? undefined : JSON.stringify(b),
  });
  let json: Json = {};
  try {
    json = res.json();
  } catch {
    /* empty */
  }
  return { status: res.statusCode, json, raw: res.body };
}
const idemKey = () => `k_${crypto.randomUUID().replace(/-/g, "")}`;
/** Runs the snapshot as if only `visible` users had opted in (the shared test DB has others). */
async function isolatedSnapshot(
  category: "research_contributor" | "investor",
  visible: string[],
  demo = false,
) {
  await owner.query("BEGIN");
  try {
    await owner.query(
      "UPDATE profiles SET appear_in_leaderboards = false WHERE appear_in_leaderboards AND NOT (user_id = ANY($1::uuid[]))",
      [visible],
    );
    return await snapshotCandidates(owner, category, { demo });
  } finally {
    await owner.query("ROLLBACK");
  }
}
async function fund(u: U, wif: bigint) {
  await call("anvil_setBalance", [u.address, "0x8AC7230489E80000"]);
  const ow = walletOf(OWNER_KEY);
  await client.waitForTransactionReceipt({
    hash: await ow.writeContract({
      address: WIF.address,
      abi: mockAbi,
      functionName: "mint",
      args: [u.address, wif],
    }),
  });
}
async function voteVia(u: U, slug: string, candidateId: number, votes: number) {
  const p = await api(u, "POST", `/elections/${slug}/vote/preview`, { candidateId, votes });
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  expect(p.json.ready, JSON.stringify(p.json.problems)).toBe(true);
  const w = walletOf(u.key);
  let voteHash: Hex = "0x";
  for (const c of p.json.calls as { to: Hex; data: Hex; step: string }[]) {
    const hash = await w.sendTransaction({ to: c.to, data: c.data });
    const r = await client.waitForTransactionReceipt({ hash });
    expect(r.status).toBe("success");
    if (c.step === "vote") voteHash = hash;
  }
  return { preview: p.json, voteHash };
}
/** Byte-level fingerprint of every reputation_* table. */
async function reputationFingerprint() {
  const tables = (
    await owner.query<{ t: string }>(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'reputation_%' ORDER BY 1",
    )
  ).rows.map((r) => r.t);
  const out: Record<string, string> = {};
  for (const t of tables)
    out[t] = (
      await owner.query<{ h: string }>(
        `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x`,
      )
    ).rows[0]!.h;
  return out;
}

// ---------------------------------------------------------------------------------------------
describe("$WIF identity (lookalike defence)", () => {
  test("the hard-coded address reports chain 4663, 18 decimals, WIF, World is Flat", async () => {
    await expect(assertWifIdentity(client)).resolves.toBeUndefined();
    const wrongChain = { ...client, getChainId: async () => 1 } as unknown as PublicClient;
    await expect(assertWifIdentity(wrongChain)).rejects.toThrow(/chainId 1/);
  });
});

describe("candidate snapshot (PO rules)", () => {
  test("hackathon fallback with labels; demo, opted-out and moderated users excluded", async () => {
    const a = await researcher();
    const b = await researcher();
    const demo = await researcher({ demo: true });
    const optedOut = await researcher({ optIn: false });
    const moderated = await researcher();
    const reporter = await user();
    await owner.query(
      "INSERT INTO moderation_reports (id, reporter_id, target_type, target_id, reason) VALUES ($1, $2, 'user', $3, 'spam')",
      [newId(), reporter.id, moderated.id],
    );
    const visible = [a.id, b.id, demo.id, optedOut.id, moderated.id];
    const snap = await isolatedSnapshot("research_contributor", visible);
    const ids = snap.map((c) => c.userId);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ids).not.toContain(demo.id);
    expect(ids).not.toContain(optedOut.id);
    expect(ids).not.toContain(moderated.id);
    expect(snap.every((c) => c.label === "building_track_record" && c.rank === null)).toBe(true);
    expect(snap.length).toBeLessThanOrEqual(8);
    // A clearly labelled demo election may list demo accounts.
    const demoSnap = await isolatedSnapshot("research_contributor", visible, true);
    expect(demoSnap.map((c) => c.userId)).toContain(demo.id);
    // Investor board: nobody here has a reconciled trade → no candidates.
    expect(await isolatedSnapshot("investor", visible)).toEqual([]);
  });

  test("candidates and rules are frozen once the election leaves draft", async () => {
    const a = await researcher();
    const snap = await isolatedSnapshot("research_contributor", [a.id]);
    const now = Date.now();
    const id = await insertDraft(
      h.db.pool,
      {
        slug: `frozen-${now}`,
        title: "Frozen test",
        category: "research_contributor",
        startsAt: new Date(now + 3600_000),
        endsAt: new Date(now + 7200_000),
        capPerWallet: 25,
        demo: false,
      },
      snap,
    );
    await markCreated(h.db.pool, id, {
      contract,
      electionId: 999_999n,
      txHash: `0x${"ab".repeat(32)}`,
    });
    const b = await researcher();
    await expect(
      h.db.pool.query(
        "INSERT INTO election_candidates (id, election_id, user_id, onchain_candidate_id) VALUES ($1, $2, $3, 2)",
        [newId(), id, b.id],
      ),
    ).rejects.toThrow(/frozen/);
    await expect(
      h.db.pool.query("UPDATE election_candidates SET rank = 1 WHERE election_id = $1", [id]),
    ).rejects.toThrow(/frozen/);
    await expect(
      h.db.pool.query("UPDATE elections SET rules = '{}' WHERE id = $1", [id]),
    ).rejects.toThrow(/frozen/);
    await expect(
      h.db.pool.query("UPDATE elections SET cap_per_wallet = 99 WHERE id = $1", [id]),
    ).rejects.toThrow(/frozen/);
    await expect(owner.query("DELETE FROM elections WHERE id = $1", [id])).rejects.toThrow(
      /append-only|not allowed/,
    );
    await expect(() =>
      insertDraft(
        h.db.pool,
        {
          slug: `bad-demo-${now}`,
          title: "Not labelled",
          category: "research_contributor",
          startsAt: new Date(now + 1e6),
          endsAt: new Date(now + 2e6),
          capPerWallet: 25,
          demo: true,
        },
        snap,
      ),
    ).rejects.toThrow(/Demo election/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("burn-to-vote end to end on a local chain-4663 anvil", () => {
  const slug = `it-research-${Date.now()}`;
  let c1: U;
  let c2: U;
  let voter: U;
  let other: U;
  let electionDbId: string;
  let firstVote: { preview: Json; voteHash: Hex };
  let repBefore: Record<string, string>;

  test("owner creates the election; the indexer opens it and notifies candidates", async () => {
    c1 = await researcher();
    c2 = await researcher();
    const snap = await isolatedSnapshot("research_contributor", [c1.id, c2.id]);
    expect(snap).toHaveLength(2);
    const chainNow = Number((await client.getBlock()).timestamp);
    const startsAt = new Date((chainNow + 60) * 1000);
    const endsAt = new Date((chainNow + 3600) * 1000);
    clock.offsetMs = startsAt.getTime() - 60_000 - Date.now();
    electionDbId = await insertDraft(
      h.db.pool,
      {
        slug,
        title: "IT Week · Research Contributor",
        category: "research_contributor",
        startsAt,
        endsAt,
        capPerWallet: 25,
        demo: false,
      },
      snap,
    );
    const ow = walletOf(OWNER_KEY);
    const hash = await ow.sendTransaction({
      to: contract,
      data: encodeCreateElection(BigInt(chainNow + 60), BigInt(chainNow + 3600), 25n, snap.length),
    });
    const r = await client.waitForTransactionReceipt({ hash });
    await markCreated(h.db.pool, electionDbId, { contract, electionId: 1n, txHash: hash });

    const t = await indexer.tick();
    expect(t.mismatches).toEqual([]);
    let e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.status).toBe("scheduled");
    expect(e.network.badge).toBe("Mainnet · real $WIF");
    expect(e.contract.address).toBe(contract);
    expect(e.capPerWallet).toBe(25);
    expect(e.irreversibilityNotice).toMatch(/cannot be refunded/);
    expect(e.labels).toContain("Season 1");
    expect(e.candidates.map((x: Json) => x.label)).toEqual([
      "Building track record",
      "Building track record",
    ]);
    expect(r.status).toBe("success");

    await mine(61);
    clock.offsetMs += 61_000;
    expect((await indexer.tick()).mismatches).toEqual([]);
    e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.status).toBe("open");
    const n = await owner.query(
      "SELECT user_id FROM notifications WHERE kind = 'election_nominated' AND election_id = $1",
      [electionDbId],
    );
    expect(n.rows.map((x) => x.user_id).sort()).toEqual([c1.id, c2.id].sort());
    await indexer.tick(); // idempotent: no duplicate notifications
    expect(
      (
        await owner.query("SELECT count(*)::int AS n FROM notifications WHERE election_id = $1", [
          electionDbId,
        ])
      ).rows[0].n,
    ).toBe(2);
    // GET /elections?status=open lists it
    expect(
      (await api(null, "GET", "/elections?status=open")).json.items.map((x: Json) => x.slug),
    ).toContain(slug);
  });

  test("preview: exact approve, decoded calls, cap, balance, simulation, burn notice, previewHash", async () => {
    voter = await user();
    other = await user();
    await fund(voter, 40n * ONE);
    repBefore = await reputationFingerprint();
    const p = await api(voter, "POST", `/elections/${slug}/vote/preview`, {
      candidateId: 1,
      votes: 3,
    });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    const j = p.json;
    expect(j.chainId).toBe(4663);
    expect(j.voter).toBe(voter.address);
    expect(j.balance).toBe((40n * ONE).toString());
    expect(j.allowance).toBe("0");
    expect(j.remainingCap).toBe("25");
    expect(j.burnAmount).toBe((3n * ONE).toString());
    expect(j.calls[0].to).toBe(WIF.address);
    expect(j.calls[0].decoded).toMatchObject({ spender: contract, amount: (3n * ONE).toString() });
    expect(j.calls[0].data.toLowerCase()).toContain((3n * ONE).toString(16).padStart(64, "0"));
    expect(j.calls[0].data).not.toMatch(/f{64}/i); // never unlimited
    expect(j.calls[1]).toMatchObject({
      to: contract,
      decoded: { electionId: "1", candidateId: "1", votes: "3" },
    });
    expect(j.simulation).toMatchObject({ ok: true, approve: "success", vote: "success" });
    expect(j.notice).toBe(
      "You are about to burn 3 real $WIF. Burned tokens are destroyed and cannot be refunded, even if the election is cancelled. Votes never affect your Suiem Score. $WIF has no promise of value or return.",
    );
    expect(j.ready).toBe(true);
    expect(j.previewHash).toMatch(/^0x[0-9a-f]{64}$/);

    const cap = await api(voter, "POST", `/elections/${slug}/vote/preview`, {
      candidateId: 1,
      votes: 26,
    });
    expect(cap.json.ready).toBe(false);
    expect(cap.json.problems.join()).toMatch(/cap/);
    expect(cap.json.previewHash).toBeNull();
    const poor = await api(other, "POST", `/elections/${slug}/vote/preview`, {
      candidateId: 1,
      votes: 1,
    });
    expect(poor.json.ready).toBe(false);
    expect(poor.json.problems.join()).toMatch(/Not enough \$WIF/);
    expect(
      (await api(voter, "POST", `/elections/${slug}/vote/preview`, { candidateId: 3, votes: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await api(voter, "POST", `/elections/${slug}/vote/preview`, { candidateId: 1, votes: 0 }))
        .status,
    ).toBe(400);
  });

  test("the vote burns real supply; binding verifies the receipt; replays and mismatches are rejected", async () => {
    const supply0 = await client.readContract({
      address: WIF.address,
      abi: mockAbi,
      functionName: "totalSupply",
    });
    firstVote = await voteVia(voter, slug, 1, 3);
    const supply1 = await client.readContract({
      address: WIF.address,
      abi: mockAbi,
      functionName: "totalSupply",
    });
    expect(supply0 - supply1).toBe(3n * ONE);
    expect(
      await client.readContract({
        address: WIF.address,
        abi: mockAbi,
        functionName: "balanceOf",
        args: [contract],
      }),
    ).toBe(0n);

    const k = idemKey();
    const body = { txHash: firstVote.voteHash, previewHash: firstVote.preview.previewHash };
    const b1 = await api(voter, "POST", `/elections/${slug}/votes`, body, { "idempotency-key": k });
    expect(b1.status, JSON.stringify(b1.json)).toBe(201);
    expect(b1.json).toMatchObject({
      election: slug,
      candidateId: 1,
      votes: 3,
      wallet: voter.address,
    });
    const b2 = await api(voter, "POST", `/elections/${slug}/votes`, body, { "idempotency-key": k });
    expect(b2.status).toBe(201);
    expect(b2.json.id).toBe(b1.json.id);
    expect(
      (
        await api(
          voter,
          "POST",
          `/elections/${slug}/votes`,
          { ...body, txHash: `0x${"11".repeat(32)}` },
          { "idempotency-key": k },
        )
      ).status,
    ).toBe(422);
    expect((await api(voter, "POST", `/elections/${slug}/votes`, body)).status).toBe(400); // no key

    // Another user cannot claim the voter's tx, even with their own preview.
    await fund(other, 5n * ONE);
    const op = await api(other, "POST", `/elections/${slug}/vote/preview`, {
      candidateId: 1,
      votes: 3,
    });
    const steal = await api(
      other,
      "POST",
      `/elections/${slug}/votes`,
      { txHash: firstVote.voteHash, previewHash: op.json.previewHash },
      { "idempotency-key": idemKey() },
    );
    expect(steal.status).toBe(409);
    // Wrong contract: the approve tx (to $WIF) bound against a fresh preview.
    const p2 = await api(voter, "POST", `/elections/${slug}/vote/preview`, {
      candidateId: 2,
      votes: 1,
    });
    const w = walletOf(voter.key);
    const approveOnly = await w.sendTransaction({
      to: p2.json.calls[0].to,
      data: p2.json.calls[0].data,
    });
    await client.waitForTransactionReceipt({ hash: approveOnly });
    const wrong = await api(
      voter,
      "POST",
      `/elections/${slug}/votes`,
      { txHash: approveOnly, previewHash: p2.json.previewHash },
      { "idempotency-key": idemKey() },
    );
    expect(wrong.status).toBe(409);
    expect(wrong.json.error.message).toMatch(/wrong contract/);
    // Wrong voter: other's own vote tx bound with the voter's preview hash → unknown preview for them.
    const ov = await voteVia(other, slug, 2, 1);
    const cross = await api(
      other,
      "POST",
      `/elections/${slug}/votes`,
      { txHash: ov.voteHash, previewHash: firstVote.preview.previewHash },
      { "idempotency-key": idemKey() },
    );
    expect(cross.status).toBe(404);
    const mine_ = await api(
      voter,
      "POST",
      `/elections/${slug}/votes`,
      { txHash: ov.voteHash, previewHash: p2.json.previewHash },
      { "idempotency-key": idemKey() },
    );
    expect(mine_.status).toBe(409);
    expect(mine_.json.error.message).toMatch(/different wallet|different vote/);
  });

  test("indexer: votes indexed idempotently, finality soft → safe → final, tallies match the contract", async () => {
    let t = await indexer.tick();
    expect(t.mismatches).toEqual([]);
    const count = async () =>
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM chain_events WHERE contract_address = $1",
          [Buffer.from(contract.slice(2), "hex")],
        )
      ).rows[0].n as number;
    const n1 = await count();
    await indexer.tick();
    await indexer.tick();
    expect(await count()).toBe(n1);
    let e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.candidates.map((c: Json) => c.votes)).toEqual(["3", "1"]);
    expect(e.tally.finality).toBe("soft");
    expect(e.totalVotes).toBe("4");
    const latest = (await client.getBlock()).number;
    fin.safe = latest;
    expect((await indexer.tick()).mismatches).toEqual([]);
    expect((await api(null, "GET", `/elections/${slug}`)).json.tally.finality).toBe("safe");
    fin.finalized = latest;
    t = await indexer.tick();
    e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.tally.finality).toBe("final");
    expect(e.tally.asOfBlock).toBeGreaterThan(0);
    const burned = await owner.query(
      "SELECT count(*)::int AS n FROM chain_events WHERE event_name = 'VoteAssetBurned' AND finality = 'final' AND NOT removed AND contract_address = $1",
      [Buffer.from(contract.slice(2), "hex")],
    );
    expect(burned.rows[0].n).toBe(2);
    expect(t.mismatches).toEqual([]);
    // /me/votes shows the bound vote at final finality.
    const mv = (await api(voter, "GET", "/me/votes")).json;
    expect(mv.items[0]).toMatchObject({
      election: slug,
      votes: 3,
      indexed: true,
      finality: "final",
    });
    expect((await api(other, "GET", "/me/votes")).json.items).toEqual([]); // scoping
  });

  test("votes list: short voter address; 'Suiem member' only per wallet_visibility", async () => {
    let v = (await api(null, "GET", `/elections/${slug}/votes`)).json;
    const mineRow = v.items.find((x: Json) => x.txHash === firstVote.voteHash.toLowerCase());
    expect(mineRow.voter).toBe(`${voter.address.slice(0, 6)}…${voter.address.slice(-4)}`);
    expect(mineRow.suiemMember).toBeNull();
    expect(JSON.stringify(v)).not.toContain(voter.address.toLowerCase().slice(2));
    expect(
      (await api(voter, "GET", `/elections/${slug}/votes`)).json.items.find(
        (x: Json) => x.txHash === mineRow.txHash,
      ).suiemMember,
    ).toEqual({ handle: voter.handle }); // self
    await owner.query("UPDATE profiles SET wallet_visibility = 'public' WHERE user_id = $1", [
      voter.id,
    ]);
    v = (await api(null, "GET", `/elections/${slug}/votes`)).json;
    expect(v.items.find((x: Json) => x.txHash === mineRow.txHash).suiemMember).toEqual({
      handle: voter.handle,
    });
    const page = (await api(null, "GET", `/elections/${slug}/votes?limit=1`)).json;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toMatch(/^\d+:\d+$/);
    const next = (
      await api(null, "GET", `/elections/${slug}/votes?limit=1&cursor=${page.nextCursor}`)
    ).json;
    expect(next.items[0].txHash).not.toBe(page.items[0].txHash);
  });

  test("simulated reorg: reverted logs are marked removed (never deleted) and tallies are fixed", async () => {
    const snap = (await call("evm_snapshot")) as string;
    const r = await voteVia(voter, slug, 2, 2);
    await indexer.tick();
    expect((await api(null, "GET", `/elections/${slug}`)).json.candidates[1].votes).toBe("3");
    const before = (await owner.query("SELECT count(*)::int AS n FROM chain_events")).rows[0].n;
    await call("evm_revert", [snap]);
    await mine();
    await mine();
    await mine();
    const t = await indexer.tick();
    expect(t.removed).toBeGreaterThan(0);
    const e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.candidates.map((c: Json) => c.votes)).toEqual(["3", "1"]);
    const rows = await owner.query("SELECT removed FROM chain_events WHERE tx_hash = $1", [
      Buffer.from(r.voteHash.slice(2), "hex"),
    ]);
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((x) => x.removed)).toBe(true);
    expect((await owner.query("SELECT count(*)::int AS n FROM chain_events")).rows[0].n).toBe(
      before,
    );
    expect(t.mismatches).toEqual([]);
    expect(logs.some((l) => l.event === "indexer.reorg")).toBe(true);
  });

  test("eth_getLogs chunking halves on a provider range error and indexes the same events", async () => {
    let calls = 0;
    const limited = {
      ...client,
      getLogs: async (args: { fromBlock: bigint; toBlock: bigint }) => {
        calls++;
        if (args.toBlock - args.fromBlock + 1n > 4n)
          throw new Error("eth_getLogs is limited to a 4 range");
        return client.getLogs(args as never);
      },
    } as unknown as PublicClient;
    const before = (await owner.query("SELECT count(*)::int AS n FROM chain_events")).rows[0].n;
    await owner.query("DELETE FROM indexer_cursors WHERE contract_address = $1", [
      Buffer.from(contract.slice(2), "hex"),
    ]);
    fin.finalized = deployBlock; // force a rescan from the deploy block
    fin.safe = deployBlock;
    const t = await newIndexer(limited, 64).tick();
    expect(t.logRange).toBeLessThanOrEqual(4);
    expect(calls).toBeGreaterThan(3);
    expect((await owner.query("SELECT count(*)::int AS n FROM chain_events")).rows[0].n).toBe(
      before,
    );
    expect(
      (await api(null, "GET", `/elections/${slug}`)).json.candidates.map((c: Json) => c.votes),
    ).toEqual(["3", "1"]);
    expect(logs.some((l) => l.event === "indexer.range_halved")).toBe(true);
  });

  test("cross-check: an indexed tally that disagrees with votes() is reported loudly, not papered over", async () => {
    const latest = (await client.getBlock()).number;
    fin.safe = latest;
    fin.finalized = latest;
    await indexer.tick();
    const fake = Buffer.from("fe".repeat(32), "hex");
    await owner.query(
      `INSERT INTO chain_events (id, chain_id, contract_address, tx_hash, log_index, block_number, block_hash, event_name, args, finality)
       VALUES ($1, 4663, $2, $3, 0, $4, $5, 'VoteCast', $6, 'final')`,
      [
        newId(),
        Buffer.from(contract.slice(2), "hex"),
        fake,
        deployBlock.toString(),
        fake,
        { electionId: "1", candidateId: "1", voter: other.address, votes: "7" },
      ],
    );
    const t = await indexer.tick();
    expect(t.mismatches).toHaveLength(1);
    expect(t.mismatches[0]).toMatchObject({ indexed: ["10", "1"], onchain: ["3", "1"] });
    expect(logs.some((l) => l.level === "error" && l.event === "indexer.tally_mismatch")).toBe(
      true,
    );
    await owner.query("UPDATE chain_events SET removed = true WHERE tx_hash = $1", [fake]);
    expect((await indexer.tick()).mismatches).toEqual([]);
  });

  test("separation: voting, binding, indexing and reorgs left every reputation_* row byte-identical", async () => {
    expect(await reputationFingerprint()).toEqual(repBefore);
  });

  test("close → finalize (anyone) → provisional → final result, notifications and winner achievement", async () => {
    await mine(3600);
    clock.offsetMs += 3600_000;
    await indexer.tick();
    expect((await api(null, "GET", `/elections/${slug}`)).json.status).toBe("closed");
    expect(
      (await api(voter, "POST", `/elections/${slug}/vote/preview`, { candidateId: 1, votes: 1 }))
        .status,
    ).toBe(409);
    const w = walletOf(other.key); // anyone may finalize
    const hash = await w.sendTransaction({ to: contract, data: encodeFinalize(1n) });
    expect((await client.waitForTransactionReceipt({ hash })).status).toBe("success");
    await indexer.tick();
    let e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.status).toBe("finalized");
    expect(e.result).toBe("provisional");
    const [winner, loser] = e.candidates.map((c: Json) => c.handle as string); // #1 got 3 votes, #2 got 1
    expect((await api(null, "GET", `/profiles/${winner}`)).json.achievements).toEqual([]);
    const latest = (await client.getBlock()).number;
    fin.safe = latest;
    fin.finalized = latest;
    await indexer.tick();
    e = (await api(null, "GET", `/elections/${slug}`)).json;
    expect(e.result).toBe("final");
    const notes = await owner.query(
      "SELECT user_id FROM notifications WHERE kind = 'election_result' AND election_id = $1",
      [electionDbId],
    );
    expect(notes.rows).toHaveLength(2);
    const prof = (await api(null, "GET", `/profiles/${winner}`)).json;
    expect(prof.achievements).toEqual([
      expect.objectContaining({
        kind: "election_winner",
        title: "Research Contributor · IT Week · Research Contributor winner",
      }),
    ]);
    expect((await api(null, "GET", `/profiles/${loser}`)).json.achievements).toEqual([]);
  });

  test("device tokens get 403 on every elections route", async () => {
    for (const [m, p] of [
      ["GET", "/elections"],
      ["GET", `/elections/${slug}`],
      ["GET", `/elections/${slug}/votes`],
      ["POST", `/elections/${slug}/vote/preview`],
      ["POST", `/elections/${slug}/votes`],
      ["GET", "/me/votes"],
    ] as const) {
      const r = await h.app.inject({
        method: m,
        url: `/api/v1${p}`,
        headers: { authorization: "Bearer sxt_fake" },
      });
      expect(r.statusCode, `${m} ${p}`).toBe(403);
      expect(r.json().error.code).toBe("DEVICE_SCOPE");
    }
    // Anonymous writes fail before auth (CSRF 403) or at auth (401); never 200.
    expect([401, 403]).toContain(
      (await api(null, "POST", `/elections/${slug}/vote/preview`, { candidateId: 1, votes: 1 }))
        .status,
    );
    expect((await api(null, "GET", "/me/votes")).status).toBe(401);
  });
});
