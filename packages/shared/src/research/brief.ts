import { z } from "zod";

/**
 * Research brief v1 (PRD §7.3). Every claim carries an id and must be supported by at least one
 * source that was actually retrieved (PRD §7.2). Facts, estimates and opinions are separated.
 */
export const BRIEF_SCHEMA_VERSION = "brief.v1" as const;

const claimId = z.string().regex(/^c[0-9]{1,4}$/);

export const claimSchema = z
  .object({
    id: claimId,
    text: z.string().min(1).max(1000),
    kind: z.enum(["fact", "estimate", "analysis", "opinion"]),
    /** Source ids (see `sources[].id`). Required: no uncited claims. */
    sourceIds: z.array(z.string().regex(/^s[0-9]{1,3}$/)).min(1),
  })
  .strict();

export const financialFigureSchema = claimSchema
  .extend({
    metric: z.string().min(1).max(80),
    /** Decimal string, never a float. */
    value: z.string().regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/),
    unit: z.string().min(1).max(20),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    period: z.string().min(1).max(40),
    asOf: z.iso.date(),
    basis: z.enum(["reported", "estimated", "calculated"]),
    formula: z.string().max(200).nullable(),
  })
  .strict();

export const sourceSchema = z
  .object({
    id: z.string().regex(/^s[0-9]{1,3}$/),
    title: z.string().min(1).max(300),
    url: z.url({ protocol: /^https?$/ }),
    publisher: z.string().max(120),
    publishedAt: z.iso.datetime().nullable(),
    retrievedAt: z.iso.datetime(),
  })
  .strict();

export const researchBriefV1 = z
  .object({
    schemaVersion: z.literal(BRIEF_SCHEMA_VERSION),
    entity: z
      .object({
        canonicalId: z.string().regex(/^ent:[a-z0-9-]+$/),
        name: z.string(),
        ticker: z.string().nullable(),
        instrumentId: z.uuid().nullable(),
      })
      .strict(),
    summary: z.string().min(1).max(2000),
    businessModel: z.array(claimSchema),
    financialHighlights: z.array(financialFigureSchema),
    valuation: z.array(claimSchema),
    recentDevelopments: z.array(claimSchema),
    competitors: z.array(claimSchema),
    bullCase: z.array(claimSchema),
    bearCase: z.array(claimSchema).min(1),
    risks: z.array(claimSchema).min(1),
    openQuestions: z.array(z.string().max(300)),
    sources: z.array(sourceSchema).min(1),
    dataFreshness: z.enum(["fresh", "stale", "partial", "unknown"]),
    disclaimer: z.string().min(1),
    generation: z
      .object({ model: z.string(), promptVersion: z.string(), generatedAt: z.iso.datetime() })
      .strict(),
  })
  .strict()
  .superRefine((brief, ctx) => {
    const sourceIds = new Set(brief.sources.map((s) => s.id));
    if (sourceIds.size !== brief.sources.length)
      ctx.addIssue({ code: "custom", path: ["sources"], message: "duplicate source id" });
    const sections = [
      "businessModel",
      "financialHighlights",
      "valuation",
      "recentDevelopments",
      "competitors",
      "bullCase",
      "bearCase",
      "risks",
    ] as const;
    const seen = new Set<string>();
    for (const section of sections) {
      brief[section].forEach((claim, i) => {
        if (seen.has(claim.id))
          ctx.addIssue({ code: "custom", path: [section, i, "id"], message: "duplicate claim id" });
        seen.add(claim.id);
        for (const sid of claim.sourceIds) {
          if (!sourceIds.has(sid))
            ctx.addIssue({
              code: "custom",
              path: [section, i, "sourceIds"],
              message: `cites unknown source ${sid}`,
            });
        }
      });
    }
  });

export type ResearchBriefV1 = z.infer<typeof researchBriefV1>;

/** Phrases the PRD forbids in research output (§7.4, §20.2). Checked after generation. */
export const FORBIDDEN_RESEARCH_PHRASES = [
  /\bguaranteed?\b/i,
  /\brisk[- ]free\b/i,
  /\b(strong )?(buy|sell) (now|signal)\b/i,
  /\bcan'?t lose\b/i,
];

export function forbiddenPhrases(brief: ResearchBriefV1): string[] {
  const texts = [
    brief.summary,
    ...[
      brief.businessModel,
      brief.valuation,
      brief.recentDevelopments,
      brief.competitors,
      brief.bullCase,
      brief.bearCase,
      brief.risks,
    ]
      .flat()
      .map((c) => c.text),
  ];
  return texts.filter((t) => FORBIDDEN_RESEARCH_PHRASES.some((re) => re.test(t)));
}
