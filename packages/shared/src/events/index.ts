import { z } from "zod";

/**
 * Product event taxonomy (PRD §2.3–2.4). The north-star metric WARC (Weekly Active Research
 * Contributors) counts unique users with ≥1 event where `countsTowardWarc` is true in a week.
 * Passive views and automated events never count.
 *
 * Props are strictly validated. They must never carry PII, page text, URLs, wallet addresses
 * or free text: only IDs, enums and small counts.
 */
export const EVENT_CATEGORIES = [
  "activation",
  "research",
  "investing",
  "social",
  "reputation",
  "economy",
  "trust",
] as const;

const noProps = z.object({}).strict();
const id = z.uuid();

export const PRODUCT_EVENTS = {
  // Activation (Phase 2)
  account_created: {
    category: "activation",
    countsTowardWarc: false,
    phase: 2,
    props: z.object({ method: z.enum(["email_otp"]) }).strict(),
  },
  consent_recorded: {
    category: "trust",
    countsTowardWarc: false,
    phase: 2,
    props: z
      .object({ purpose: z.string().max(40), action: z.enum(["granted", "withdrawn"]) })
      .strict(),
  },
  onboarding_completed: {
    category: "activation",
    countsTowardWarc: false,
    phase: 2,
    props: z.object({ interestsSkipped: z.boolean(), walletLinked: z.boolean() }).strict(),
  },
  interests_updated: {
    category: "activation",
    countsTowardWarc: false,
    phase: 2,
    props: z.object({ count: z.number().int().min(0).max(50) }).strict(),
  },
  passkey_added: { category: "trust", countsTowardWarc: false, phase: 2, props: noProps },
  wallet_linked: {
    category: "activation",
    countsTowardWarc: false,
    phase: 2,
    props: z.object({ chainId: z.literal(46630) }).strict(),
  },
  data_request_created: {
    category: "trust",
    countsTowardWarc: false,
    phase: 2,
    props: z.object({ type: z.enum(["export", "delete"]) }).strict(),
  },

  // Meaningful research actions (PRD §2.3). Defined now so they stay stable; emitted from Phase 3+.
  research_brief_saved: {
    category: "research",
    countsTowardWarc: true,
    phase: 3,
    props: z.object({ briefId: id }).strict(),
  },
  thesis_published: {
    category: "research",
    countsTowardWarc: true,
    phase: 4,
    props: z.object({ thesisId: id }).strict(),
  },
  thesis_review_completed: {
    category: "research",
    countsTowardWarc: true,
    phase: 4,
    props: z.object({ thesisId: id }).strict(),
  },
  helpful_review_given: {
    category: "social",
    countsTowardWarc: true,
    phase: 5,
    props: z.object({ postId: id }).strict(),
  },

  // Explicitly NOT meaningful (counted for diagnostics only).
  research_panel_opened: {
    category: "research",
    countsTowardWarc: false,
    phase: 3,
    props: z.object({ entityId: z.string().max(64) }).strict(),
  },
  notification_shown: { category: "research", countsTowardWarc: false, phase: 3, props: noProps },
} as const satisfies Record<
  string,
  {
    category: (typeof EVENT_CATEGORIES)[number];
    countsTowardWarc: boolean;
    phase: number;
    props: z.ZodType;
  }
>;

export type ProductEventName = keyof typeof PRODUCT_EVENTS;
export type ProductEventProps<N extends ProductEventName> = z.infer<
  (typeof PRODUCT_EVENTS)[N]["props"]
>;

export interface ProductEvent<N extends ProductEventName = ProductEventName> {
  name: N;
  userId: string;
  occurredAt: string;
  props: ProductEventProps<N>;
}

export function validateEvent<N extends ProductEventName>(
  name: N,
  props: unknown,
): ProductEventProps<N> {
  const def = PRODUCT_EVENTS[name];
  if (def === undefined) throw new Error("Unknown product event");
  return def.props.parse(props) as ProductEventProps<N>;
}

/** WARC over a set of events in one ISO week: unique users with a meaningful event. */
export function computeWarc(
  events: readonly Pick<ProductEvent, "name" | "userId">[],
  excludedUserIds: ReadonlySet<string> = new Set(),
): number {
  const users = new Set<string>();
  for (const e of events) {
    if (PRODUCT_EVENTS[e.name].countsTowardWarc && !excludedUserIds.has(e.userId))
      users.add(e.userId);
  }
  return users.size;
}
