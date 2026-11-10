import { z } from "zod";

/** Stable, machine-readable error codes. Never put user data in messages. */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "MFA_REQUIRED",
  "REASON_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "CSRF_FAILED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "PASSKEY_FAILED",
  "SIWE_INVALID",
  "WALLET_ALREADY_LINKED",
  "CONSENT_REQUIRED",
  "CONSENT_INVALID_TRANSITION",
  "POLICY_DENIED",
  "FLAG_LOCKED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  MFA_REQUIRED: 403,
  REASON_REQUIRED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_FAILED: 403,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  PASSKEY_FAILED: 400,
  SIWE_INVALID: 400,
  WALLET_ALREADY_LINKED: 409,
  CONSENT_REQUIRED: 403,
  CONSENT_INVALID_TRANSITION: 409,
  POLICY_DENIED: 403,
  FLAG_LOCKED: 409,
  INTERNAL: 500,
};
