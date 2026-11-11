import type { ApiEnv as Env } from "@suiem/config/env";
import type { DbHandle } from "@suiem/db";
import { GeminiModel } from "./models/gemini";
import { GroqModel } from "./models/groq";
import type { ResearchModel } from "./models/types";
import { DbSourceCache, type SourceCache } from "./providers/cache";
import { EdgarProvider } from "./providers/edgar";
import { FinnhubProvider } from "./providers/finnhub";
import type { FilingsProvider, MarketDataProvider } from "./providers/types";

type ResearchEnv = Pick<
  Env,
  | "GROQ_API_KEY"
  | "GROQ_MODEL"
  | "GEMINI_API_KEY"
  | "GEMINI_MODEL"
  | "FINNHUB_API_KEY"
  | "SEC_USER_AGENT"
  | "RESEARCH_CACHE_TTL_HOURS"
>;

/** Builds providers/models from env. A missing key disables that provider (reported as missing data). */
export function researchProviders(env: ResearchEnv, db: DbHandle | null, cache?: SourceCache) {
  const ttlMs = env.RESEARCH_CACHE_TTL_HOURS * 3_600_000;
  const c = cache ?? new DbSourceCache(db!);
  const filings: FilingsProvider | null = env.SEC_USER_AGENT
    ? new EdgarProvider(env.SEC_USER_AGENT, c, ttlMs)
    : null;
  const market: MarketDataProvider | null = env.FINNHUB_API_KEY
    ? new FinnhubProvider(env.FINNHUB_API_KEY, c, ttlMs)
    : null;
  const models: ResearchModel[] = [];
  if (env.GROQ_API_KEY) models.push(new GroqModel(env.GROQ_API_KEY, env.GROQ_MODEL));
  if (env.GEMINI_API_KEY) models.push(new GeminiModel(env.GEMINI_API_KEY, env.GEMINI_MODEL));
  return { filings, market, models, ttlMs };
}
