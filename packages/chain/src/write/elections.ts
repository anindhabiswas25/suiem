/**
 * The ONLY place that builds SuiemElections / $WIF calldata (mainnet 4663: REAL value).
 * Used by the vote preview (API), the PO's own vote tool and the owner CLI. Nothing here signs
 * or sends: callers hold their own keys. Approvals are always for the exact amount.
 */
import { WIF } from "@suiem/config/chains";
import { type Address, decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from "viem";
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
