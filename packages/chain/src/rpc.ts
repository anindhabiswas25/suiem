/**
 * RPC hygiene for secret endpoints (the PO's QuickNode URL carries its auth token in the path).
 *
 * - `redactRpcSecrets` scrubs any RPC URL with a secret part from text: QuickNode hosts become
 *   `https://<quicknode>/…`, Alchemy keys are cut and any explicitly registered URL is replaced.
 * - `secretHttp` wraps viem's `http` transport so every error that leaves it (message,
 *   shortMessage, details, url, stack, metaMessages and the whole cause chain) is redacted, and
 *   paces requests to a configurable rate. viem's own retry already backs off on HTTP 429.
 */
import { http, type HttpTransportConfig, type Transport } from "viem";

const QUICKNODE_RE = /https?:\/\/[^\s"'`<>]*quiknode\.pro[^\s"'`<>]*/gi;
const ALCHEMY_RE = /(https?:\/\/[a-z0-9.-]*alchemy\.com\/v2\/)[^\s"'`<>/]+/gi;
const registered = new Set<string>();

/** Remember a secret URL so it is also scrubbed in its exact form (e.g. without a trailing slash). */
export function registerSecretRpcUrl(url: string | undefined): void {
  if (!url) return;
  registered.add(url);
  registered.add(url.replace(/\/+$/, ""));
}

export function redactRpcSecrets(text: string): string {
  let out = text;
  for (const url of registered) if (url.length > 12) out = out.split(url).join("https://<rpc>/…");
  return out.replace(QUICKNODE_RE, "https://<quicknode>/…").replace(ALCHEMY_RE, "$1<key>");
}

/** A short, safe label for logs: never the URL itself. */
export function rpcLabel(url: string | undefined): string {
  if (!url) return "public";
  if (/quiknode\.pro/i.test(url)) return "quicknode";
  if (/alchemy\.com/i.test(url)) return "alchemy";
  if (/127\.0\.0\.1|localhost/.test(url)) return "local";
  return "custom";
}

const STRING_FIELDS = ["message", "shortMessage", "details", "url", "stack", "docsPath"] as const;

/** Redacts an error and its cause chain in place, then returns it. */
export function redactError<T>(error: T, depth = 0): T {
  if (!error || typeof error !== "object" || depth > 8) return error;
  const e = error as Record<string, unknown>;
  for (const key of STRING_FIELDS) {
    const v = e[key];
    if (typeof v === "string") {
      try {
        Object.defineProperty(e, key, {
          value: redactRpcSecrets(v),
          writable: true,
          configurable: true,
        });
      } catch {
        /* frozen: leave it */
      }
    }
  }
  if (Array.isArray(e.metaMessages))
    e.metaMessages = (e.metaMessages as unknown[]).map((m) =>
      typeof m === "string" ? redactRpcSecrets(m) : m,
    );
  if ("cause" in e) redactError(e.cause, depth + 1);
  return error;
}

/** Simple pacing limiter: at most `rps` requests per second for this transport. */
function pacer(rps: number) {
  const gap = rps > 0 ? 1000 / rps : 0;
  let next = 0;
  return async () => {
    if (gap === 0) return;
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

export interface SecretHttpOptions extends HttpTransportConfig {
  /** Requests per second (0 = unlimited). Default 15 (QuickNode Build plan headroom). */
  maxRps?: number;
}

/** viem `http` transport that never leaks its URL through errors and respects a request rate. */
export function secretHttp(url: string, options: SecretHttpOptions = {}): Transport {
  registerSecretRpcUrl(url);
  const { maxRps = 15, ...rest } = options;
  const inner = http(url, { retryCount: 3, retryDelay: 250, ...rest });
  const wait = pacer(maxRps);
  return (params) => {
    const t = inner(params);
    return {
      ...t,
      request: (async (args: Parameters<typeof t.request>[0]) => {
        await wait();
        try {
          return await t.request(args);
        } catch (error) {
          throw redactError(error);
        }
      }) as typeof t.request,
    };
  };
}
