// The PO's own real-vote tool: burns REAL $WIF on Robinhood Chain mainnet 4663.
// Run it in YOUR terminal with your key in YOUR shell environment (never in .env, never shared):
//
//   VOTER_PRIVATE_KEY=0x… pnpm wif:vote --election <slug | onchain id> --candidate <n> --votes <k>
//
// It runs the same preview as the API (balance, allowance, cap, exact approve + vote calldata,
// simulation), prints the burn notice and the decoded calls, and continues only after you type
// `BURN <k> WIF`. Then it sends approve (exact amount) and vote, and prints both tx links.
// The indexer picks the vote up from the chain. The RPC URL and key are never printed.
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  createSuiemPublicClient,
  redactRpcSecrets,
  registerSecretRpcUrl,
  secretHttp,
} from "@suiem/chain";
import { assertWifIdentity, explorerTx, loadElectionsDeployment } from "@suiem/chain/elections";
import { buildVotePreview, decodeVote, decodeWifApprove } from "@suiem/chain/write";
import { robinhoodMainnet } from "@suiem/config/chains";
import { burnNotice, IRREVERSIBILITY_NOTICE } from "@suiem/shared/elections";
import { createWalletClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const say = (s: string) => console.log(redactRpcSecrets(s));
const fail = (s: string): never => {
  say(`ERROR: ${s}`);
  process.exit(1);
};

const election = arg("--election") ?? fail("--election <slug | onchain id> is required");
const candidate = Number(arg("--candidate") ?? fail("--candidate <n> is required"));
const votes = Number(arg("--votes") ?? fail("--votes <k> is required"));
if (!Number.isInteger(candidate) || candidate < 1) fail("--candidate must be a positive integer");
if (!Number.isInteger(votes) || votes < 1) fail("--votes must be a positive whole number");
const key = process.env.VOTER_PRIVATE_KEY as Hex | undefined;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
  fail("set VOTER_PRIVATE_KEY in your shell environment (this tool never stores it)");
const voter = privateKeyToAccount(key!);
const rpc = arg("--rpc") ?? process.env.MAINNET_RPC_URL ?? robinhoodMainnet.rpcUrls.default.http[0];
registerSecretRpcUrl(rpc);
const manifest = arg("--manifest"); // local fork rehearsal only
const deployment =
  loadElectionsDeployment(
    manifest ? join(import.meta.dirname, "..", "packages", "contracts", manifest) : undefined,
  ) ?? fail("no deployments/4663.json");
const contract = deployment.elections;
const client = createSuiemPublicClient({ chainId: 4663, rpcUrl: rpc, maxRps: 10 });
if ((await client.getChainId()) !== 4663) fail("RPC is not Robinhood Chain mainnet 4663");
await assertWifIdentity(client);

let onchainId: bigint;
if (/^\d+$/.test(election)) onchainId = BigInt(election);
else {
  const api = process.env.API_URL ?? "http://localhost:4000";
  const r = await fetch(`${api}/api/v1/elections/${encodeURIComponent(election)}`);
  if (!r.ok)
    fail(
      `could not read election ${election} from ${api} (HTTP ${r.status}); pass the onchain id instead`,
    );
  const e = (await r.json()) as {
    onchainElectionId: string | null;
    contract: { address: string } | null;
  };
  if (!e.onchainElectionId || e.contract?.address.toLowerCase() !== contract.toLowerCase())
    fail("election is not on the deployed contract");
  onchainId = BigInt(e.onchainElectionId!);
}

const p = await buildVotePreview(client, {
  contract,
  wallet: voter.address,
  electionId: onchainId,
  candidateId: BigInt(candidate),
  votes: BigInt(votes),
});
const a = decodeWifApprove(p.approve.data);
const v = decodeVote(p.vote.data);
say(
  [
    "",
    "Mainnet · real $WIF  (Robinhood Chain 4663)",
    `voter ${voter.address} · $WIF balance ${p.balance / 10n ** 18n} · allowance ${p.allowance} · remaining cap ${p.remaining}`,
    `1) $WIF.approve(spender=${a.spender}, amount=${a.amount})  ← exact, never unlimited`,
    `2) SuiemElections(${contract}).vote(electionId=${v.electionId}, candidateId=${v.candidateId}, votes=${v.votes})`,
    `simulation: approve ${p.simulation.approve}, vote ${p.simulation.vote}${p.simulation.error ? ` (${p.simulation.error})` : ""}`,
    "",
    burnNotice(votes),
    IRREVERSIBILITY_NOTICE,
    "",
  ].join("\n"),
);
if (p.problems.length) fail(p.problems.join("; "));

const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = (await rl.question(`Type exactly "BURN ${votes} WIF" to continue: `)).trim();
rl.close();
if (typed !== `BURN ${votes} WIF`) fail("confirmation did not match: nothing sent");

const wallet = createWalletClient({
  account: voter,
  chain: robinhoodMainnet,
  transport: secretHttp(rpc, { maxRps: 10 }),
});
let approveHash: Hex | null = null;
if (p.allowance < p.amount) {
  approveHash = await wallet.sendTransaction({ to: p.approve.to, data: p.approve.data });
  say(`approve sent ${approveHash} · ${explorerTx(approveHash)}`);
  const r = await client.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
  if (r.status !== "success") fail("approve reverted");
} else say("allowance already covers this vote: skipping approve");
const voteHash = await wallet.sendTransaction({ to: p.vote.to, data: p.vote.data });
say(`vote sent ${voteHash} · ${explorerTx(voteHash)}`);
const r = await client.waitForTransactionReceipt({ hash: voteHash, timeout: 120_000 });
if (r.status !== "success") fail("vote reverted");
say(
  [
    "",
    `Done in block ${r.blockNumber}. ${votes} $WIF burned.`,
    approveHash ? `approve: ${explorerTx(approveHash)}` : "",
    `vote:    ${explorerTx(voteHash)}`,
    "The Suiem indexer records it from the chain (soft → safe → final).",
  ]
    .filter(Boolean)
    .join("\n"),
);
