import type { ApiEnv } from "@suiem/config/env";
import type { DbHandle } from "@suiem/db";
import {
  type FilingsProvider,
  type MarketDataProvider,
  type PipelineDeps,
  type Quota,
  RedisQuota,
  researchProviders,
  type ResearchModel,
} from "@suiem/research";
import type { Redis } from "ioredis";

export const RESEARCH = Symbol("RESEARCH");

/** Everything the API needs from the research worker library. Tests inject mocks. */
export interface ResearchRuntime {
  filings: FilingsProvider | null;
  market: MarketDataProvider | null;
  models: ResearchModel[];
  quota: Quota;
  dailyLimit: number;
  cacheTtlMs: number;
  /** Puts a research request on the queue (BullMQ in production). */
  enqueue(requestId: string): Promise<void>;
}

/** Providers and models from env; enqueue is attached by main.ts (no queue in scripts/tests). */
export function researchRuntimeFromEnv(
  env: ApiEnv,
  db: DbHandle,
  redis: Redis,
  enqueue?: (id: string) => Promise<void>,
): ResearchRuntime {
  const p = researchProviders(env, db);
  return {
    filings: p.filings,
    market: p.market,
    models: p.models,
    quota: new RedisQuota(redis),
    dailyLimit: env.RESEARCH_DAILY_LIMIT_PER_USER,
    cacheTtlMs: p.ttlMs,
    enqueue: enqueue ?? (async () => {}),
  };
}

export function pipelineDeps(
  rt: ResearchRuntime,
  db: DbHandle,
  now: () => Date,
  log: PipelineDeps["log"],
): PipelineDeps {
  return {
    db,
    filings: rt.filings,
    market: rt.market,
    models: rt.models,
    quota: rt.quota,
    dailyLimit: rt.dailyLimit,
    cacheTtlMs: rt.cacheTtlMs,
    now,
    log,
  };
}
