import { z } from "zod";
import { CONSENT_PURPOSES, consentEventSchema } from "../consent";
import { FEATURE_FLAGS, JURISDICTION_RE } from "../policy";

/** API DTOs for /api/v1, shared by apps/api (validation + OpenAPI) and apps/web (typed client). */

export const SUIEM_SIWE_CHAIN_IDS = [4663, 46630] as const;

// ---- Auth: passkey + SIWE (ADR-0010 §4) ---------------------------------------------------
export const authMethodSchema = z.enum(["passkey", "siwe"]);
export type AuthMethodKind = z.infer<typeof authMethodSchema>;

export const csrfResponse = z.object({ csrfToken: z.string() });

export const sessionResponse = z.object({
  userId: z.uuid(),
  authMethods: z.array(authMethodSchema),
  isNewUser: z.boolean(),
});

/** WebAuthn payloads are validated structurally here; @simplewebauthn verifies them. */
export const passkeyOptionsResponse = z.object({ options: z.record(z.string(), z.unknown()) });
export const passkeyVerifyRequest = z
  .object({ response: z.record(z.string(), z.unknown()) })
  .strict();

export const siweNonceRequest = z
  .object({ chainId: z.union([z.literal(4663), z.literal(46630)]) })
  .strict();
export const siweNonceResponse = z.object({
  nonce: z.string(),
  issuedAt: z.string(),
  expirationTime: z.string(),
  chainId: z.union([z.literal(4663), z.literal(46630)]),
  domain: z.string(),
  uri: z.string(),
  statement: z.string(),
});
export const siweVerifyRequest = z
  .object({
    message: z.string().min(50).max(2000),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  })
  .strict();
export const walletLinkRequest = siweVerifyRequest
  .extend({ custodyAcknowledged: z.literal(true) })
  .strict();

export const walletAccount = z.object({
  id: z.uuid(),
  chainId: z.number().int(),
  address: z.string(),
  linkedAt: z.string(),
});
export const walletListResponse = z.object({ items: z.array(walletAccount) });

// ---- Me / onboarding ----------------------------------------------------------------------
export const INTERESTS = [
  "technology",
  "healthcare",
  "energy",
  "finance",
  "ai",
  "consumer",
  "industrials",
  "real_estate",
  "crypto",
  "education",
] as const;
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "experienced"] as const;
export const RESEARCH_DEPTHS = ["plain_language", "balanced", "detailed"] as const;

export const meResponse = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
  researchDepth: z.enum(RESEARCH_DEPTHS).nullable(),
  interests: z.array(z.enum(INTERESTS)),
  interestsSkipped: z.boolean(),
  onboardingCompletedAt: z.string().nullable(),
  authMethods: z.array(authMethodSchema),
  passkeyCount: z.number().int(),
  wallets: z.array(walletAccount),
  requiredConsentsGranted: z.boolean(),
  stockTokenEligible: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponse>;

export const patchMeRequest = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable().optional(),
    jurisdiction: z.string().regex(JURISDICTION_RE).optional(),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
    researchDepth: z.enum(RESEARCH_DEPTHS).optional(),
    interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional(),
    interestsSkipped: z.boolean().optional(),
    onboardingCompleted: z.literal(true).optional(),
  })
  .strict();
export type PatchMeRequest = z.infer<typeof patchMeRequest>;

// ---- Consents -----------------------------------------------------------------------------
export const consentStateItem = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  status: z.enum(["not_asked", "granted", "withdrawn", "outdated"]),
  policyVersion: z.string().nullable(),
  currentPolicyVersion: z.string(),
  updatedAt: z.string().nullable(),
  required: z.boolean(),
  available: z.boolean(),
  title: z.string(),
  summaryUrl: z.string(),
});
export const consentsResponse = z.object({ items: z.array(consentStateItem) });
export const postConsentRequest = consentEventSchema.strict();

// ---- Config -------------------------------------------------------------------------------
export const configResponse = z.object({
  flags: z.record(z.enum(FEATURE_FLAGS), z.boolean()),
  chains: z.array(
    z.object({ id: z.number(), name: z.string(), network: z.enum(["mainnet", "testnet"]) }),
  ),
});

export const stockTokenEligibilityResponse = z.object({
  eligible: z.boolean(),
  reason: z.enum(["restricted_jurisdiction", "jurisdiction_not_declared"]).optional(),
  network: z.literal("testnet"),
  chainId: z.literal(46630),
});
