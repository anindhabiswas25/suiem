import { z } from "zod";

/**
 * Extension ↔ service-worker ↔ API messages (PRD §6). Content scripts never send page text
 * automatically. Research context is sent only on an explicit user action.
 */
export const EXTENSION_STATES = ["on", "paused", "off", "private"] as const;
export type ExtensionState = (typeof EXTENSION_STATES)[number];

export const detectionSchema = z
  .object({
    entityId: z.string().regex(/^ent:[a-z0-9-]+$/),
    candidateTickers: z.array(z.string().max(12)).max(5),
    confidence: z.number().min(0).max(1),
    contextCategory: z.enum(["company_reference", "possible_match", "ambiguous"]),
    /** Hash of the matched span: never the text itself. */
    evidenceSpanHash: z.string().regex(/^[0-9a-f]{64}$/),
    domain: z.string().max(253),
    detectedAt: z.iso.datetime(),
    ambiguityReason: z.string().max(200).nullable(),
  })
  .strict();

export const contentToWorker = z.discriminatedUnion("type", [
  z.object({ type: z.literal("detection"), detection: detectionSchema }).strict(),
  z.object({ type: z.literal("dismiss"), entityId: z.string() }).strict(),
]);

export const workerToContent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: z.enum(EXTENSION_STATES) }).strict(),
  z
    .object({
      type: z.literal("notify"),
      entityId: z.string(),
      name: z.string(),
      why: z.string().max(200),
    })
    .strict(),
]);

/** POST /api/v1/extension/research-context: only after the user confirmed what is shared. */
export const researchContextRequest = z
  .object({
    entityId: z.string().regex(/^ent:[a-z0-9-]+$/),
    sourceUrl: z.url({ protocol: /^https?$/ }).max(2048),
    /** Optional, only if the user explicitly chose to include a selected excerpt. */
    selectedExcerpt: z.string().max(2000).optional(),
    userConfirmed: z.literal(true),
  })
  .strict();
