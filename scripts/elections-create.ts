// Owner CLI for SuiemElections on Robinhood Chain MAINNET 4663 (real $WIF).
// Dry run by default: snapshots candidates and prints chain, contract, times, cap, candidates and
// the gas estimate. Sends ONLY with --send AND CONFIRM_MAINNET_TX=I_HAVE_PO_APPROVAL.
//
//   pnpm elections:create --slug hackathon-week-1-research --title "Hackathon Week 1 · Research Contributor" \
//        --category research_contributor --start +5m --end 2026-11-18T17:00:00Z --cap 25 [--demo] [--send]
//   pnpm elections:create --finalize <slug> [--send]     # anyone may finalize after the end
//   pnpm elections:create --cancel <slug> [--send]       # owner, before the start only
// Options: --rpc <url> (local fork rehearsal), --manifest <path> (default deployments/4663.json).
// The owner key is MAINNET_DEPLOYER_PRIVATE_KEY (never printed). The RPC URL is never printed.
import { join } from "node:path";
import {
  createSuiemPublicClient,
  redactRpcSecrets,
  registerSecretRpcUrl,
  rpcLabel,
  secretHttp,
} from "@suiem/chain";
import {
  assertWifIdentity,
  explorerTx,
  loadElectionsDeployment,
  suiemElectionsAbi,
} from "@suiem/chain/elections";
import { encodeCancelElection, encodeCreateElection, encodeFinalize } from "@suiem/chain/write";
import { robinhoodMainnet } from "@suiem/config/chains";
import { connect } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { createWalletClient, decodeEventLog, formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type ElectionCategory, snapshotCandidates } from "../apps/api/src/elections/candidates";
import { buildRules, insertDraft, markCreated } from "../apps/api/src/elections/create";

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (n: string) => argv.includes(n);
const say = (s: string) => console.log(redactRpcSecrets(s));
const fail = (s: string): never => {
  say(`ERROR: ${s}`);
  process.exit(1);
};

const rpc = arg("--rpc") ?? process.env.MAINNET_RPC_URL;
if (!rpc) fail("MAINNET_RPC_URL must be set in .env (or --rpc for a local fork)");
registerSecretRpcUrl(rpc);
const manifestPath = arg("--manifest");
const deployment = loadElectionsDeployment(
  manifestPath ? join(import.meta.dirname, "..", "packages", "contracts", manifestPath) : undefined,
);
if (!deployment) fail("SuiemElections is not deployed (no deployments/4663.json)");
const contract = deployment!.elections;
const key = process.env.MAINNET_DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) fail("MAINNET_DEPLOYER_PRIVATE_KEY must be set in .env");
const owner = privateKeyToAccount(key!);
const client = createSuiemPublicClient({ chainId: 4663, rpcUrl: rpc, maxRps: 10 });
if ((await client.getChainId()) !== 4663) fail("RPC is not chain 4663");
await assertWifIdentity(client);
const db = connect(process.env.DATABASE_URL!, { applicationName: "suiem-elections-cli" });
const send = flag("--send");

async function audit(action: string, targetId: string, details: Record<string, unknown>) {
  await db.pool.query(
    `INSERT INTO audit_logs (id, actor_type, action, target_type, target_id, outcome, details)
     VALUES ($1, 'admin', $2, 'election', $3, 'success', $4)`,
    [newId(), action, targetId, details],
  );
}

async function sendTx(data: Hex, label: string) {
  if (process.env.CONFIRM_MAINNET_TX !== "I_HAVE_PO_APPROVAL")
    fail(
      `${label}: mainnet owner transactions need CONFIRM_MAINNET_TX=I_HAVE_PO_APPROVAL (explicit PO approval)`,
    );
  const wallet = createWalletClient({
    account: owner,
    chain: robinhoodMainnet,
    transport: secretHttp(rpc!, { maxRps: 10 }),
  });
  const hash = await wallet.sendTransaction({ to: contract, data });
  say(`${label}: sent ${hash} · ${explorerTx(hash)}`);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") fail(`${label}: transaction reverted (${hash})`);
  return receipt;
}

async function costLine(data: Hex) {
  const gas = await client.estimateGas({ account: owner.address, to: contract, data });
  const price = await client.getGasPrice();
  const bal = await client.getBalance({ address: owner.address });
  return `gas ≈ ${gas} at ${price} wei/gas ≈ ${formatEther(gas * price)} ETH · owner ${owner.address} holds ${formatEther(bal)} ETH`;
}

const parseTime = (v: string | undefined, name: string): Date => {
  if (!v) return fail(`--${name} is required`);
  const rel = /^\+(\d+)m$/.exec(v);
  const d = rel ? new Date(Date.now() + Number(rel[1]) * 60_000) : new Date(v);
  if (Number.isNaN(d.getTime())) fail(`--${name}: bad time ${v}`);
  return d;
};

// ---- finalize / cancel ------------------------------------------------------------------------
const finalizeSlug = arg("--finalize");
const cancelSlug = arg("--cancel");
if (finalizeSlug || cancelSlug) {
  const slug = (finalizeSlug ?? cancelSlug)!;
  const e = (
    await db.pool.query<{ id: string; onchain: string | null; status: string }>(
      "SELECT id, onchain_election_id::text AS onchain, status FROM elections WHERE slug = $1",
      [slug],
    )
  ).rows[0];
  if (!e?.onchain) fail(`unknown or not-created election ${slug}`);
  const id = BigInt(e!.onchain!);
  const data = finalizeSlug ? encodeFinalize(id) : encodeCancelElection(id);
  const what = finalizeSlug ? "finalize" : "cancel";
  say(
    `chain 4663 (${rpcLabel(rpc)}) · contract ${contract} · ${what} ${slug} (onchain id ${id}, DB status ${e!.status})`,
  );
  say(await costLine(data));
  if (!send) {
    say("dry run: nothing sent (add --send)");
    process.exit(0);
  }
  const r = await sendTx(data, what);
  await audit(`election.${what}`, e!.id, {
    txHash: r.transactionHash,
    block: r.blockNumber.toString(),
  });
  say(`${what} confirmed in block ${r.blockNumber}. The indexer updates status and results.`);
  await db.close();
  process.exit(0);
}

// ---- create -----------------------------------------------------------------------------------
const slug = arg("--slug") ?? fail("--slug is required");
const title = arg("--title") ?? fail("--title is required");
const category = (arg("--category") ?? fail("--category is required")) as ElectionCategory;
if (!["research_contributor", "investor"].includes(category))
  fail("--category must be research_contributor or investor");
const startsAt = parseTime(arg("--start"), "start");
const endsAt = parseTime(arg("--end"), "end");
const cap = Number(arg("--cap") ?? 25);
const demo = flag("--demo");
const plan = { slug, title, category, startsAt, endsAt, capPerWallet: cap, demo };
const candidates = await snapshotCandidates(db.pool, category, { demo });
if (candidates.length === 0) fail("no eligible candidates for this board (nothing created)");
const rules = buildRules(plan, candidates);
const start = BigInt(Math.floor(startsAt.getTime() / 1000));
const end = BigInt(Math.floor(endsAt.getTime() / 1000));
const data = encodeCreateElection(start, end, BigInt(cap), candidates.length);
say(
  [
    `chain 4663 (${rpcLabel(rpc)} RPC) · Mainnet · real $WIF`,
    `contract ${contract}`,
    `election "${title}" (${slug}) · ${category} · labels: ${rules.labels.join(", ")}`,
    `opens ${startsAt.toISOString()} · closes ${endsAt.toISOString()} · cap ${cap} votes per wallet`,
    `candidates (${candidates.length}, frozen at creation; source ${rules.candidateSource}):`,
    ...candidates.map(
      (c, i) =>
        `  #${i + 1} @${c.handle}${c.displayName ? ` (${c.displayName})` : ""} · ${c.board} · ${c.label === "ranked" ? `rank ${c.rank}, score ${c.score}` : "Building track record"}`,
    ),
    await costLine(data),
  ].join("\n"),
);
if (!send) {
  say("dry run: nothing written or sent (add --send after PO approval)");
  await db.close();
  process.exit(0);
}
if (process.env.CONFIRM_MAINNET_TX !== "I_HAVE_PO_APPROVAL")
  fail(
    "mainnet owner transactions need CONFIRM_MAINNET_TX=I_HAVE_PO_APPROVAL (explicit PO approval)",
  );
const id = await insertDraft(db.pool, plan, candidates);
const receipt = await sendTx(data, "createElection");
const created = receipt.logs
  .filter((l) => l.address.toLowerCase() === contract.toLowerCase())
  .map((l) => {
    try {
      return decodeEventLog({ abi: suiemElectionsAbi, data: l.data, topics: l.topics });
    } catch {
      return null;
    }
  })
  .find((d) => d?.eventName === "ElectionCreated");
if (!created || created.eventName !== "ElectionCreated")
  fail("no ElectionCreated event in the receipt");
const onchainId = (created as { args: { electionId: bigint } }).args.electionId;
await markCreated(db.pool, id, {
  contract,
  electionId: onchainId,
  txHash: receipt.transactionHash,
});
await audit("election.created", id, {
  slug,
  onchainElectionId: onchainId.toString(),
  txHash: receipt.transactionHash,
  candidates: candidates.length,
  cap,
});
say(
  `created ${slug}: onchain id ${onchainId} · block ${receipt.blockNumber} · ${explorerTx(receipt.transactionHash)}`,
);
await db.close();
