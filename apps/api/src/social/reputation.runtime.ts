import type { DbHandle } from "@suiem/db";
import {
  type JobDeps,
  type QuoteSource,
  recomputeUser,
  type StoredSnapshot,
} from "@suiem/reputation";
import type { ResearchRuntime } from "../research/runtime";
import type { Clock } from "../tokens";

export const REPUTATION = Symbol("REPUTATION");

export interface ReputationRuntime {
  deps: JobDeps;
  recompute(userId: string): Promise<StoredSnapshot>;
}

/** Finnhub quotes (via the research runtime's market provider) for SPY and thesis evaluation. */
export function finnhubQuotes(research: ResearchRuntime): QuoteSource | null {
  const market = research.market;
  if (!market) return null;
  return async (ticker) => {
    const q = await market.quote(ticker);
    if (!q.data.t || !Number.isFinite(q.data.c) || q.data.c <= 0)
      throw new Error(`no quote for ${ticker}`);
    return {
      price: String(q.data.c),
      asOf: new Date(q.data.t * 1000),
      source: "Finnhub (free tier)",
    };
  };
}

export function reputationRuntime(
  db: DbHandle,
  quotes: QuoteSource | null,
  clock: Clock,
  log?: JobDeps["log"],
): ReputationRuntime {
  const deps: JobDeps = { db, quotes, now: () => clock.now(), log };
  return { deps, recompute: (userId) => recomputeUser(deps, userId) };
}
