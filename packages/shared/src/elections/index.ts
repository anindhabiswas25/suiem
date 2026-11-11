import { z } from "zod";

/** Mainnet badge for every election surface (ADR-0010 §1). */
export const ELECTIONS_NETWORK_BADGE = "Mainnet · real $WIF" as const;

/** Shown (and returned by the API) before any vote is built. Never says "investment". */
export const IRREVERSIBILITY_NOTICE =
  "Votes are final. Voting burns real $WIF: burned tokens are destroyed and cannot be refunded, changed or reversed, even if the election is cancelled. Votes never affect anyone's Suiem Score. $WIF has no promise of value or return." as const;

export const burnNotice = (votes: number | bigint) =>
  `You are about to burn ${votes} real $WIF. Burned tokens are destroyed and cannot be refunded, even if the election is cancelled. Votes never affect your Suiem Score. $WIF has no promise of value or return.`;

export const ELECTION_CATEGORY_TITLE = {
  research_contributor: "Research Contributor",
  investor: "Investor",
  educational: "Educational",
  community_spotlight: "Community Spotlight",
} as const;

export const CANDIDATE_LABEL = {
  ranked: "Ranked",
  building_track_record: "Building track record",
} as const;

export const ELECTION_STATUSES = ["scheduled", "open", "closed", "finalized", "cancelled"] as const;

export const electionListQuery = z.object({
  status: z.enum(ELECTION_STATUSES).optional(),
});
export const electionSlugParam = z.string().regex(/^[a-z0-9-]{3,64}$/);
export const votesCursorQuery = z.object({
  cursor: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Whole votes only (1 $WIF = 1 vote). The candidate id is the onchain id (1..n). */
export const votePreviewRequest = z.object({
  candidateId: z.number().int().min(1).max(8),
  votes: z.number().int().min(1).max(1_000_000),
});

export const voteBindRequest = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  previewHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
