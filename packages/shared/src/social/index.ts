import { z } from "zod";

/** Social, profile, feed, notification and reputation DTOs (Sprint 6, PRD §9–§10). */

export const VISIBILITIES = ["private", "followers", "public"] as const;
export const visibility = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof visibility>;

/** Same rule as the users.handle CHECK constraint. */
export const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
export const handleParam = z.string().regex(HANDLE_RE);

/** Per-field privacy settings (PRD §9.4). Defaults are private; leaderboard off. */
export const PRIVACY_FIELDS = [
  {
    key: "portfolioVisibility",
    label: "Portfolio allocation",
    help: "Allocation percentages per book (simulated, testnet demo) with a timestamp. Never quantities, amounts or addresses.",
  },
  {
    key: "positionsVisibility",
    label: "Positions",
    help: "Each open position's return in percent. Requires the portfolio to be visible too.",
  },
  {
    key: "transactionsVisibility",
    label: "Transactions",
    help: "Your recent buys and sells (date, side, instrument, book). No amounts.",
  },
  {
    key: "thesesVisibility",
    label: "Theses on your profile",
    help: "Which of your published theses are listed on your profile. Each thesis also keeps its own visibility.",
  },
  {
    key: "researchActivityVisibility",
    label: "Research activity",
    help: "The companies you researched recently and when. Brief contents stay private unless you share them.",
  },
  {
    key: "followersVisibility",
    label: "Followers list",
    help: "Your follower and following counts and lists.",
  },
  {
    key: "walletVisibility",
    label: "Linked wallet address",
    help: "Your linked wallet address. Anything onchain is already public: showing the address links your Suiem profile to every transaction it ever made.",
  },
] as const;
export type PrivacyKey = (typeof PRIVACY_FIELDS)[number]["key"];

export const privacySettings = z.object({
  portfolioVisibility: visibility,
  positionsVisibility: visibility,
  transactionsVisibility: visibility,
  thesesVisibility: visibility,
  researchActivityVisibility: visibility,
  followersVisibility: visibility,
  walletVisibility: visibility,
  appearInLeaderboards: z.boolean(),
});

const plainText = (max: number) =>
  z
    .string()
    .max(max)
    // No control characters except newline and tab.
    .refine(
      (s) =>
        ![...s].some((ch) => {
          const c = ch.charCodeAt(0);
          return (c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127;
        }),
      "Control characters are not allowed",
    );

export const patchProfileRequest = privacySettings
  .partial()
  .extend({
    handle: handleParam.optional(),
    displayName: plainText(60).trim().min(1).nullable().optional(),
    bio: plainText(500).trim().nullable().optional(),
    /** Must be true when enabling wallet visibility (the onchain-publicity caveat was shown). */
    acknowledgeOnchainPublicity: z.literal(true).optional(),
  })
  .strict();
export type PatchProfileRequest = z.infer<typeof patchProfileRequest>;

export const POST_KINDS = [
  "research_brief",
  "thesis",
  "discussion",
  "portfolio_snapshot",
  "learning_note",
  "question",
] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const createPostRequest = z
  .object({
    kind: z.enum(POST_KINDS),
    body: plainText(10_000).trim().min(1),
    /** Required: nothing is public by default (the composer preselects the source's visibility). */
    visibility,
    entityId: z
      .string()
      .regex(/^ent:[a-z0-9-]+$/)
      .optional(),
    thesisId: z.uuid().optional(),
    briefId: z.uuid().optional(),
  })
  .strict();
export type CreatePostRequest = z.infer<typeof createPostRequest>;

export const createCommentRequest = z
  .object({ body: plainText(4000).trim().min(1), parentId: z.uuid().optional() })
  .strict();

export const REACTION_KINDS = ["helpful", "not_helpful"] as const;
export const reactionRequest = z.object({ kind: z.enum(REACTION_KINDS) }).strict();

export const REPORT_REASONS = [
  "spam",
  "scam",
  "harassment",
  "impersonation",
  "manipulation",
  "undisclosed_sponsorship",
  "fraudulent_performance",
  "other",
] as const;
export const reportRequest = z
  .object({ reason: z.enum(REPORT_REASONS), note: plainText(1000).optional() })
  .strict();

export const feedQuery = z
  .object({
    tab: z.enum(["following", "discover"]).default("following"),
    cursor: z.string().max(200).optional(),
    entityId: z
      .string()
      .regex(/^ent:[a-z0-9-]+$/)
      .optional(),
  })
  .strict();

export const appealRequest = z
  .object({ reason: plainText(2000).trim().min(10), snapshotId: z.uuid().optional() })
  .strict();

export const LEADERBOARDS = ["suiem", "research", "investors"] as const;
export const leaderboardParam = z.enum(LEADERBOARDS);
export const leaderboardQuery = z
  .object({
    period: z.enum(["week", "all"]).default("week"),
    showDemo: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .strict();

export const resolveReportRequest = z
  .object({
    action: z.enum(["hide", "dismiss"]),
    reason: z.enum(REPORT_REASONS),
    note: plainText(1000).optional(),
  })
  .strict();
export const resolveAppealRequest = z
  .object({ action: z.enum(["reviewed", "recalculate"]), note: plainText(2000).trim().min(1) })
  .strict();

// ---- Responses (OpenAPI documentation; responses are built by the API) ----------------------

export const authorRef = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string().nullable(),
  isDemo: z.boolean(),
});

export const postLabels = z.object({
  sourced: z.boolean(),
  aiAssisted: z.boolean(),
  sponsored: z.boolean(),
  simulatedTestnet: z.boolean(),
});

export const postView = z.object({
  id: z.uuid(),
  kind: z.enum(POST_KINDS),
  body: z.string(),
  author: authorRef,
  visibility,
  entity: z.object({ id: z.string(), name: z.string() }).nullable(),
  attachment: z.record(z.string(), z.unknown()).nullable(),
  labels: postLabels,
  counts: z.object({ helpful: z.number(), notHelpful: z.number(), comments: z.number() }),
  viewer: z.object({
    reaction: z.enum(REACTION_KINDS).nullable(),
    bookmarked: z.boolean(),
    isAuthor: z.boolean(),
  }),
  createdAt: z.string(),
});
export type PostView = z.infer<typeof postView>;

export const feedResponse = z.object({
  items: z.array(postView),
  nextCursor: z.string().nullable(),
  trending: z.array(z.object({ id: z.string(), name: z.string(), activity: z.number() })),
});
