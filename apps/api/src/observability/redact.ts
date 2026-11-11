/**
 * Allowlist-based redaction (PRD §18.2, ADR-0003 §2). Only keys listed here reach logs or audit
 * details. String values are scrubbed again for emails, hex addresses/hashes, long tokens and
 * six-digit codes, so a sensitive value under an allowed key is still removed.
 */
export const ALLOWED_LOG_KEYS = new Set([
  "level",
  "time",
  "msg",
  "service",
  "env",
  "requestId",
  "method",
  "route",
  "statusCode",
  "durationMs",
  "userId",
  "sessionId",
  "adminUserId",
  "actorType",
  "action",
  "outcome",
  "event",
  "errorCode",
  "errName",
  "errMessage",
  "component",
  "reasonCode",
  "purpose",
  "capability",
  "allowed",
  "policyVersion",
  "flag",
  "enabled",
  "count",
  "migration",
  "chainId",
  "kind",
  "status",
  "type",
  "role",
  "attempt",
  "dualControlId",
  "decision",
  "port",
  "phase",
  "target",
  "targetType",
  "jurisdiction",
  "pid",
  "hostname",
  // Sprint 6 audit details (ids and codes only, never content).
  "fields",
  "reports",
  "snapshotBefore",
  "snapshotAfter",
  "changed",
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HEX_RE = /0x[0-9a-f]{8,}/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{24,}\b/g;
const SIX_DIGITS_RE = /(?<![0-9])[0-9]{6}(?![0-9])/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function scrubString(value: string): string {
  // Protect UUIDs (internal, non-personal IDs) from the generic token scrubber.
  const uuids: string[] = [];
  const masked = value.replace(UUID_RE, (m) => `\uE000${uuids.push(m) - 1}\uE000`);
  const scrubbed = masked
    .replace(/(https?:\/\/[^\s?#"]+)\?[^\s#"]*/gi, "$1?[query]")
    .replace(EMAIL_RE, "[email]")
    .replace(HEX_RE, "[hex]")
    .replace(LONG_TOKEN_RE, "[token]")
    .replace(SIX_DIGITS_RE, "[code]");
  return scrubbed.replace(/\uE000(\d+)\uE000/g, (_, i: string) => uuids[Number(i)] ?? "");
}

const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value).slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ALLOWED_LOG_KEYS.has(k)) out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return "[unsupported]";
}

/** Error → loggable fields: name, code and scrubbed message only. No stack values, no causes. */
export function errorFields(error: unknown): {
  errName: string;
  errMessage: string;
  errorCode?: string;
} {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      errName: error.name,
      errMessage: scrubString(error.message).slice(0, 300),
      ...(typeof code === "string" ? { errorCode: code } : {}),
    };
  }
  return { errName: "NonError", errMessage: "[non-error thrown]" };
}
