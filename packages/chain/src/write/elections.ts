/**
 * The ONLY place that builds SuiemElections / $WIF calldata (mainnet 4663: REAL value).
 * Used by the vote preview (API), the PO's own vote tool and the owner CLI. Nothing here signs
 * or sends: callers hold their own keys. Approvals are always for the exact amount.
 */
import { WIF } from "@suiem/config/chains";
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  parseAbiParameters,
  type PublicClient,
} from "viem";
import { suiemElectionsAbi } from "../abi/elections";

export const ELECTIONS_CHAIN = 4663 as const;
const ONE = 10n ** 18n;

export class NotMainnetError extends Error {
  constructor(chainId: number) {
    super(`SuiemElections runs only on chain ${ELECTIONS_CHAIN}; refusing chain ${chainId}`);
    this.name = "NotMainnetError";
  }
}
export const assertElectionsChain = (chainId: number) => {
  if (chainId !== ELECTIONS_CHAIN) throw new NotMainnetError(chainId);
};

/** Whole votes → $WIF base units (1 vote = 1 whole token). */
export function burnAmount(votes: bigint): bigint {
  if (votes <= 0n) throw new Error("votes must be a positive whole number");
  return votes * ONE;
}

/** Exact `approve(SuiemElections, amount)` on the hard-coded $WIF. Never unlimited. */
export function encodeWifApprove(spender: Address, amount: bigint): { to: Address; data: Hex } {
  if (amount <= 0n || amount % ONE !== 0n) throw new Error("approval must be whole tokens");
  return {
    to: WIF.address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  };
}

export function encodeVote(electionId: bigint, candidateId: bigint, votes: bigint): Hex {
  burnAmount(votes);
  return encodeFunctionData({
    abi: suiemElectionsAbi,
    functionName: "vote",
    args: [electionId, candidateId, votes],
  });
}

export function decodeVote(data: Hex) {
  const d = decodeFunctionData({ abi: suiemElectionsAbi, data });
  if (d.functionName !== "vote") throw new Error(`not a vote call: ${d.functionName}`);
  const [electionId, candidateId, votes] = d.args;
  return { functionName: "vote" as const, electionId, candidateId, votes };
}

export function decodeWifApprove(data: Hex) {
  const d = decodeFunctionData({ abi: erc20Abi, data });
  if (d.functionName !== "approve") throw new Error(`not an approve call: ${d.functionName}`);
  const [spender, amount] = d.args;
  return { functionName: "approve" as const, spender, amount };
}

// ---- owner calls (CLI only; every send needs explicit PO approval) ------------------------------

export const encodeCreateElection = (start: bigint, end: bigint, cap: bigint, candidates: number) =>
  encodeFunctionData({
    abi: suiemElectionsAbi,
    functionName: "createElection",
    args: [start, end, cap, candidates],
  });
export const encodeCancelElection = (id: bigint) =>
  encodeFunctionData({ abi: suiemElectionsAbi, functionName: "cancel", args: [id] });
export const encodeFinalize = (id: bigint) =>
  encodeFunctionData({ abi: suiemElectionsAbi, functionName: "finalize", args: [id] });

/** Binds a vote preview to the voter and exactly the two calls their wallet will send. */
export function votePreviewHash(
  chainId: number,
  voter: Address,
  approve: { to: Address; data: Hex },
  vote: { to: Address; data: Hex },
): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, address, bytes, address, bytes"), [
      BigInt(chainId),
      voter,
      approve.to,
      approve.data,
      vote.to,
      vote.data,
    ]),
  );
}

export interface VotePreviewCore {
  amount: bigint;
  balance: bigint;
  allowance: bigint;
  remaining: bigint;
  approve: { to: Address; data: Hex };
  vote: { to: Address; data: Hex };
  problems: string[];
  simulation: { ok: boolean; approve: string; vote: string; error?: string };
  previewHash: Hex;
}

/**
 * The single vote-preview routine (API `POST /elections/:slug/vote/preview` and `pnpm wif:vote`):
 * reads balance, allowance and remaining cap, builds the exact approve + vote calls and simulates
 * both in order from the voter's wallet (eth_simulateV1). Sends nothing.
 */
export async function buildVotePreview(
  client: Pick<PublicClient, "readContract" | "simulateCalls">,
  p: { contract: Address; wallet: Address; electionId: bigint; candidateId: bigint; votes: bigint },
): Promise<VotePreviewCore> {
  const amount = burnAmount(p.votes);
  const [balance, allowance, remaining] = await Promise.all([
    client.readContract({
      address: WIF.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [p.wallet],
    }),
    client.readContract({
      address: WIF.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [p.wallet, p.contract],
    }),
    client.readContract({
      address: p.contract,
      abi: suiemElectionsAbi,
      functionName: "remainingCap",
      args: [p.electionId, p.wallet],
    }),
  ]);
  const approve = encodeWifApprove(p.contract, amount);
  const vote = { to: p.contract, data: encodeVote(p.electionId, p.candidateId, p.votes) };
  const problems: string[] = [];
  if (p.votes > remaining)
    problems.push(`Over the per-wallet cap: this wallet can cast ${remaining} more vote(s) here`);
  if (balance < amount) problems.push(`Not enough $WIF: wallet holds ${balance / ONE} whole $WIF`);
  let simulation: VotePreviewCore["simulation"];
  try {
    const sim = await client.simulateCalls({ account: p.wallet, calls: [approve, vote] });
    const [a, v] = sim.results;
    simulation = {
      ok: a?.status === "success" && v?.status === "success",
      approve: a?.status ?? "unknown",
      vote: v?.status ?? "unknown",
      ...(v?.status === "failure" ? { error: v.error?.name ?? "reverted" } : {}),
    };
  } catch (error) {
    simulation = {
      ok: false,
      approve: "unknown",
      vote: "unknown",
      error: error instanceof Error ? error.name : "simulation unavailable",
    };
  }
  if (!simulation.ok && problems.length === 0) problems.push("The vote simulation failed");
  return {
    amount,
    balance,
    allowance,
    remaining,
    approve,
    vote,
    problems,
    simulation,
    previewHash: votePreviewHash(ELECTIONS_CHAIN, p.wallet, approve, vote),
  };
}
