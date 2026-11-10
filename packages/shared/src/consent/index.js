import { z } from "zod";
/**
 * Consent state machine (PRD §5.1, §16.3–16.4, ADR-0003). Pure: no I/O.
 * Records are append-only. State is always derived from the full record history plus the
 * currently published policy versions.
 */
export const CONSENT_PURPOSES = [
  "terms",
  "privacy",
  "product_analytics",
  "marketing_email",
  "extension_detection",
  "digest_sync",
];
/** Purposes without which an account cannot exist. Withdrawing them means closing the account. */
export const REQUIRED_PURPOSES = ["terms", "privacy"];
/** Purposes that cannot be granted yet because their feature ships in a later phase. */
export const NOT_YET_AVAILABLE = ["extension_detection", "digest_sync"];
export function deriveConsentState(records, current) {
  const sorted = [...records].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const out = {};
  for (const purpose of CONSENT_PURPOSES) {
    const last = sorted.filter((r) => r.purpose === purpose).at(-1);
    let status = "not_asked";
    if (last?.action === "withdrawn") status = "withdrawn";
    else if (last?.action === "granted")
      status = last.policyVersion === current[purpose] ? "granted" : "outdated";
    out[purpose] = {
      purpose,
      status,
      policyVersion: last?.policyVersion ?? null,
      currentPolicyVersion: current[purpose],
      updatedAt: last?.recordedAt ?? null,
    };
  }
  return out;
}
/** Validates a proposed consent event against current state. */
export function checkTransition(state, event) {
  const s = state[event.purpose];
  if (event.action === "granted") {
    if (NOT_YET_AVAILABLE.includes(event.purpose)) {
      return {
        ok: false,
        code: "CONSENT_INVALID_TRANSITION",
        reason: "This feature is not available yet.",
      };
    }
    if (event.policyVersion !== s.currentPolicyVersion) {
      return {
        ok: false,
        code: "CONSENT_INVALID_TRANSITION",
        reason: "Consent must reference the current policy version.",
      };
    }
    if (s.status === "granted") {
      return {
        ok: false,
        code: "CONSENT_INVALID_TRANSITION",
        reason: "Already granted for this version.",
      };
    }
    return { ok: true };
  }
  // withdrawn
  if (s.status !== "granted" && s.status !== "outdated") {
    return { ok: false, code: "CONSENT_INVALID_TRANSITION", reason: "Nothing to withdraw." };
  }
  if (REQUIRED_PURPOSES.includes(event.purpose)) {
    return {
      ok: false,
      code: "CONSENT_REQUIRED",
      reason:
        "Terms and privacy consent are required for an account. Request account deletion instead.",
    };
  }
  return { ok: true };
}
/** An account may use the product only while every required purpose is granted at the current version. */
export function hasRequiredConsents(state) {
  return REQUIRED_PURPOSES.every((p) => state[p].status === "granted");
}
export const consentEventSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  action: z.enum(["granted", "withdrawn"]),
  policyVersion: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$/),
});
