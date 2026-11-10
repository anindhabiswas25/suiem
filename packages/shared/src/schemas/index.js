import { z } from "zod";
import { CONSENT_PURPOSES, consentEventSchema } from "../consent";
import { CAPABILITIES, FEATURE_FLAGS, JURISDICTION_RE } from "../policy";
/** API DTOs for /api/v1, shared by apps/api (validation + OpenAPI) and apps/web (typed client). */
export const emailSchema = z
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());
export const otpCodeSchema = z.string().regex(/^[0-9]{6}$/, "Code must be 6 digits");
// ---- Auth ---------------------------------------------------------------------------------
export const startOtpRequest = z.object({ email: emailSchema }).strict();
export const startOtpResponse = z.object({
  status: z.literal("sent"),
  expiresInSeconds: z.number().int(),
});
export const verifyOtpRequest = z.object({ email: emailSchema, code: otpCodeSchema }).strict();
export const authMethodSchema = z.enum(["email_otp", "passkey"]);
export const sessionResponse = z.object({
  userId: z.uuid(),
  authMethods: z.array(authMethodSchema),
  isNewUser: z.boolean(),
});
/** WebAuthn ceremony payloads are validated structurally; @simplewebauthn verifies content. */
export const passkeyOptionsResponse = z.object({ options: z.record(z.string(), z.unknown()) });
export const passkeyVerifyRequest = z
  .object({ response: z.record(z.string(), z.unknown()) })
  .strict();
// ---- Me / profile -------------------------------------------------------------------------
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
];
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "experienced"];
export const RESEARCH_DEPTHS = ["plain_language", "balanced", "detailed"];
export const meResponse = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
  researchDepth: z.enum(RESEARCH_DEPTHS).nullable(),
  interests: z.array(z.enum(INTERESTS)),
  interestsSkipped: z.boolean(),
  onboardingCompletedAt: z.string().nullable(),
  authMethods: z.array(authMethodSchema),
  passkeyCount: z.number().int(),
  isAdmin: z.boolean(),
  requiredConsentsGranted: z.boolean(),
});
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
// ---- Data rights --------------------------------------------------------------------------
export const dataInventoryResponse = z.object({
  generatedAt: z.string(),
  categories: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string(),
      count: z.number().int(),
      retention: z.string(),
      sharedWith: z.array(z.string()),
    }),
  ),
});
export const dataRequestCreate = z.object({ type: z.enum(["export", "delete"]) }).strict();
export const dataRequestResponse = z.object({
  id: z.uuid(),
  type: z.enum(["export", "delete"]),
  status: z.enum(["received", "processing", "completed", "rejected"]),
  createdAt: z.string(),
});
// ---- Wallet (linking only; SIWE is never a login method) ------------------------------------
export const walletNonceResponse = z.object({
  nonce: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  chainId: z.literal(46630),
  domain: z.string(),
  uri: z.string(),
});
export const walletLinkRequest = z
  .object({
    message: z.string().min(50).max(2000),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
    custodyAcknowledged: z.literal(true),
  })
  .strict();
export const walletAccount = z.object({
  id: z.uuid(),
  chainId: z.number().int(),
  address: z.string(),
  kind: z.enum(["external_eoa", "smart_account"]),
  linkedAt: z.string(),
});
export const walletListResponse = z.object({ items: z.array(walletAccount) });
// ---- Config / navigation ------------------------------------------------------------------
export const navigationResponse = z.object({
  policyVersion: z.string(),
  jurisdiction: z.string().nullable(),
  capabilities: z.record(
    z.enum(CAPABILITIES),
    z.object({ allowed: z.boolean(), reason: z.string() }),
  ),
  flags: z.record(z.enum(FEATURE_FLAGS), z.boolean()),
});
// ---- Admin --------------------------------------------------------------------------------
export const REASON_CODES = [
  "SUPPORT_TICKET",
  "INCIDENT",
  "MODERATION",
  "SECURITY_REVIEW",
  "CONFIG_CHANGE",
  "AUDIT",
  "TEST_ENV",
];
export const ADMIN_ROLES = ["support", "moderator", "ops", "security", "superadmin"];
export const adminReason = z.object({
  reasonCode: z.enum(REASON_CODES),
  reasonNote: z.string().trim().min(3).max(500),
});
export const auditSearchQuery = z.object({
  actorId: z.uuid().optional(),
  action: z.string().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const DUAL_CONTROL_ACTIONS = ["feature_flag.set", "admin_role.grant", "admin_role.revoke"];
export const dualControlCreate = adminReason
  .extend({
    action: z.enum(DUAL_CONTROL_ACTIONS),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export const dualControlDecision = adminReason
  .extend({ decision: z.enum(["approve", "reject"]) })
  .strict();
export const flagSetPayload = z
  .object({ key: z.enum(FEATURE_FLAGS), enabled: z.boolean() })
  .strict();
export const roleChangePayload = z.object({ userId: z.uuid(), role: z.enum(ADMIN_ROLES) }).strict();
