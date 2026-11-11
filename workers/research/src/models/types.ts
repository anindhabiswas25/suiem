/** A research language model behind one interface (ADR-0006). Implementations: Groq, Gemini. */
export interface GenerateInput {
  system: string;
  user: string;
  /** Strict JSON Schema (all fields required, additionalProperties false). */
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
}
export interface GenerateOutput {
  json: unknown;
  /** Tokens used (prompt + completion) when the provider reports it. */
  tokens: number;
}
export interface ResearchModel {
  readonly provider: "groq" | "gemini" | "mock";
  readonly model: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

/** kind drives fallback: rate_limit / unavailable / timeout → try the next model. */
export class ModelError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: "rate_limit" | "unavailable" | "timeout" | "bad_output" | "config" | "rejected",
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function classifyStatus(provider: string, status: number): ModelError {
  if (status === 429) return new ModelError(provider, "rate_limit", `${provider} rate limit (429)`);
  if (status >= 500)
    return new ModelError(provider, "unavailable", `${provider} unavailable (${status})`);
  return new ModelError(provider, "rejected", `${provider} rejected the request (${status})`);
}

export async function timedFetch(
  fetcher: Fetcher,
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as Error).name;
    throw new ModelError(
      provider,
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable",
      `${provider} request failed (${name})`,
    );
  }
}
