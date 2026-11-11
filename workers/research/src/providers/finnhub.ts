import { cached, type SourceCache } from "./cache";
import { createHttp, type Fetcher, ProviderError } from "./http";
import type {
  FinnhubMetrics,
  FinnhubNews,
  FinnhubProfile,
  FinnhubQuote,
  MarketDataProvider,
} from "./types";

const BASE = "https://finnhub.io/api/v1";
/** Metric keys surfaced as valuation figures (everything else is dropped). */
export const FINNHUB_METRIC_KEYS = [
  "peTTM",
  "psTTM",
  "pbAnnual",
  "evEbitdaTTM",
  "marketCapitalization",
  "52WeekHigh",
  "52WeekLow",
  "beta",
  "dividendYieldIndicatedAnnual",
] as const;

export class FinnhubProvider implements MarketDataProvider {
  private readonly get;
  constructor(
    apiKey: string | undefined,
    private readonly cache: SourceCache,
    private readonly ttlMs: number,
    opts: { fetcher?: Fetcher; minIntervalMs?: number } = {},
  ) {
    if (!apiKey) throw new ProviderError("finnhub", 0, "FINNHUB_API_KEY is required");
    // Free plan: ~60/min; we throttle to ~30/min. Key goes in a header, never in a logged URL.
    this.get = createHttp({
      provider: "finnhub",
      headers: { "X-Finnhub-Token": apiKey },
      minIntervalMs: opts.minIntervalMs ?? 2000,
      fetcher: opts.fetcher,
    });
  }

  profile(ticker: string) {
    return this.load<FinnhubProfile>(
      `profile:${ticker}`,
      `${BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}`,
    );
  }
  quote(ticker: string) {
    // Quotes are short-lived: cache for one minute at most.
    return cached(this.cache, "finnhub", `quote:${ticker}`, Math.min(this.ttlMs, 60_000), () =>
      this.get<FinnhubQuote>(`${BASE}/quote?symbol=${encodeURIComponent(ticker)}`),
    ).then((r) => ({ data: r.data, retrievedAt: r.retrievedAt }));
  }
  peers(ticker: string) {
    return this.load<string[]>(
      `peers:${ticker}`,
      `${BASE}/stock/peers?symbol=${encodeURIComponent(ticker)}`,
    );
  }
  async metrics(ticker: string) {
    const r = await cached(this.cache, "finnhub", `metric:${ticker}`, this.ttlMs, async () => {
      const raw = await this.get<{ metric?: FinnhubMetrics }>(
        `${BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`,
      );
      const out: FinnhubMetrics = {};
      for (const k of FINNHUB_METRIC_KEYS)
        if (raw.metric?.[k] !== undefined) out[k] = raw.metric[k] ?? null;
      return out;
    });
    return { data: r.data, retrievedAt: r.retrievedAt };
  }
  async news(ticker: string, from: string, to: string) {
    const r = await cached(
      this.cache,
      "finnhub",
      `news:${ticker}:${from}:${to}`,
      this.ttlMs,
      async () => {
        const raw = await this.get<FinnhubNews[]>(
          `${BASE}/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}`,
        );
        return raw
          .filter((n) => n.url && n.headline)
          .sort((a, b) => b.datetime - a.datetime)
          .slice(0, 8)
          .map((n) => ({
            id: n.id,
            datetime: n.datetime,
            headline: n.headline.slice(0, 300),
            source: n.source,
            summary: (n.summary ?? "").slice(0, 600),
            url: n.url,
          }));
      },
    );
    return { data: r.data, retrievedAt: r.retrievedAt };
  }

  private async load<T>(key: string, url: string) {
    const r = await cached(this.cache, "finnhub", key, this.ttlMs, () => this.get<T>(url));
    return { data: r.data, retrievedAt: r.retrievedAt };
  }
}
