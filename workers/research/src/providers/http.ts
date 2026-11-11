/** Small HTTP helper for public data providers: timeout, retry with backoff on 429/5xx, throttle. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  provider: string;
  headers: Record<string, string>;
  /** Minimum milliseconds between requests to this provider. */
  minIntervalMs: number;
  timeoutMs?: number;
  retries?: number;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
}

export function createHttp(options: HttpOptions) {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let next = 0;
  return async function getJson<T>(url: string): Promise<T> {
    const retries = options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait);
      next = Date.now() + options.minIntervalMs;
      let res: Response;
      try {
        res = await fetcher(url, {
          headers: options.headers,
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch (error) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ProviderError(
          options.provider,
          0,
          `${options.provider} request failed: ${(error as Error).name}`,
        );
      }
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(
        options.provider,
        res.status,
        `${options.provider} returned HTTP ${res.status}`,
      );
    }
  };
}
