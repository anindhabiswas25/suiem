export interface Candidate {
  candidateId: number;
  handle: string | null;
  displayName: string | null;
  board: string | null;
  rank: number | null;
  label: string;
  votes: string;
  finality: string | null;
  asOfBlock: number | null;
}

export interface Election {
  slug: string;
  title: string;
  category: string;
  categoryTitle: string;
  labels: string[];
  status: "scheduled" | "open" | "closed" | "finalized" | "cancelled";
  result: "none" | "provisional" | "final";
  startsAt: string;
  endsAt: string;
  finalizedAt: string | null;
  network: { chainId: number; badge: string };
  contract: { address: string; explorerUrl: string } | null;
  onchainElectionId: string | null;
  createTx: { hash: string; explorerUrl: string } | null;
  capPerWallet: number | null;
  voteAsset: { symbol: string; address: string; decimals: number; perVote: string };
  irreversibilityNotice: string;
  totalVotes: string;
  tally: { asOfBlock: number | null; finality: string | null };
  candidates: Candidate[];
}

export interface VoteRow {
  voter: string;
  suiemMember: { handle: string } | null;
  candidateId: number;
  votes: string;
  burned: string;
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
  finality: string;
}

export interface VoteClaim {
  id: string;
  election: string;
  candidateId: number;
  votes: number;
  burned: string;
  wallet: string;
  txHash: string;
  explorerUrl: string;
  indexed: boolean;
  finality: string | null;
  boundAt: string;
}

export interface VotePreview {
  chainId: 4663;
  voter: string;
  candidateId: number;
  votes: number;
  burnAmount: string;
  balance: string;
  allowance: string;
  remainingCap: string;
  calls: {
    step: "approve" | "vote";
    to: string;
    data: string;
    value: string;
    decoded: Record<string, string>;
  }[];
  simulation: { ok: boolean; approve: string; vote: string; error?: string };
  ready: boolean;
  problems: string[];
  notice: string;
  irreversibilityNotice: string;
  previewHash: string | null;
  expiresAt: string | null;
}

/** Is voting open right now (by status and time window)? */
export const isOpen = (e: Election, now = Date.now()) =>
  e.status === "open" &&
  new Date(e.startsAt).getTime() <= now &&
  now < new Date(e.endsAt).getTime();

export const candidateName = (c: Candidate) =>
  c.displayName ?? (c.handle ? `@${c.handle}` : "Deleted account");

export const FINALITY_LABEL: Record<string, string> = {
  soft: "Seen on chain",
  safe: "Safe",
  final: "Final",
};
