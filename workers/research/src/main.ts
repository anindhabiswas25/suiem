// Standalone research worker (use with RESEARCH_WORKER=off on the API). Same env as the API.
import { loadApiEnv } from "@suiem/config/env";
import { connect } from "@suiem/db";
import { Redis } from "ioredis";
import { researchProviders } from "./factory";
import { startResearchWorker } from "./queue";
import { RedisQuota } from "./quota";

const env = loadApiEnv();
const db = connect(env.DATABASE_URL, { applicationName: "suiem-research" });
const p = researchProviders(env, db);
const log = (event: string, fields: Record<string, unknown>) =>
  process.stdout.write(
    `${JSON.stringify({ level: "info", service: "suiem-research", msg: event, ...fields })}\n`,
  );
startResearchWorker(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), {
  db,
  filings: p.filings,
  market: p.market,
  models: p.models,
  quota: new RedisQuota(new Redis(env.REDIS_URL)),
  dailyLimit: env.RESEARCH_DAILY_LIMIT_PER_USER,
  cacheTtlMs: p.ttlMs,
  now: () => new Date(),
  log,
});
log("research worker started", {
  models: p.models.map((m) => `${m.provider}:${m.model}`),
  concurrency: 2,
});
