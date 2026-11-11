import {
  createSuiemPublicClient,
  assertSuiemChain,
  registerSecretRpcUrl,
  rpcLabel,
} from "@suiem/chain";
import { assertWifIdentity } from "@suiem/chain/elections";
import { ElectionsIndexer, startIndexerLoop } from "@suiem/indexer";
import { electionsRuntimeFromEnv } from "./elections/runtime";
import { robinhoodMainnet, robinhoodTestnet } from "@suiem/config/chains";
import { loadApiEnv } from "@suiem/config/env";
import { connect } from "@suiem/db";
import { enqueueResearch, researchQueue, startResearchWorker } from "@suiem/research";
import { Redis } from "ioredis";
import { startReputationJobs } from "@suiem/reputation";
import { createApp } from "./app";
import { finnhubQuotes, reputationRuntime } from "./social/reputation.runtime";
import { pipelineDeps, researchRuntimeFromEnv } from "./research/runtime";
import { createRedis } from "./infra/redis";
import { createLogger } from "./observability/logger";
import { errorFields } from "./observability/redact";
import { systemClock } from "./tokens";

/** Boot: validate env, check both chains report the expected IDs, then serve. */
export async function bootstrap(source: Record<string, string | undefined> = process.env) {
  const env = loadApiEnv(source);
  const logger = createLogger({ level: env.LOG_LEVEL, service: "suiem-api", env: env.NODE_ENV });
  // Secret RPC URLs (QuickNode) are scrubbed from every error that leaves a transport.
  registerSecretRpcUrl(env.MAINNET_RPC_URL);
  registerSecretRpcUrl(env.TESTNET_RPC_URL);
  for (const [chain, rpcUrl] of [
    [robinhoodMainnet.id, env.MAINNET_RPC_URL],
    [robinhoodTestnet.id, env.TESTNET_RPC_URL],
  ] as const) {
    const client = createSuiemPublicClient({
      chainId: chain,
      rpcUrl,
      alchemyApiKey: env.ALCHEMY_API_KEY,
      timeoutMs: 8000,
    });
    await assertSuiemChain(client, chain);
    logger.info({ chainId: chain, component: "boot" }, "chain check passed");
  }
  const db = connect(env.DATABASE_URL, { applicationName: "suiem-api" });
  const redis = createRedis(env.REDIS_URL);
  // Research queue (BullMQ needs its own connections with maxRetriesPerRequest: null).
  const queueConn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = researchQueue(queueConn);
  const research = researchRuntimeFromEnv(env, db, redis, (id) => enqueueResearch(queue, id));
  logger.info(
    {
      component: "research",
      models: research.models.map((m) => `${m.provider}:${m.model}`),
      edgar: !!research.filings,
      finnhub: !!research.market,
    },
    "research providers",
  );
  if (env.RESEARCH_WORKER === "inline") {
    const deps = pipelineDeps(
      research,
      db,
      () => systemClock.now(),
      (event, fields) => logger.info({ component: "research", ...fields }, event),
    );
    startResearchWorker(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }), deps, 2);
    logger.info({ component: "research" }, "research worker running inline (concurrency 2)");
  }
  const reputation = reputationRuntime(db, finnhubQuotes(research), systemClock, (event, fields) =>
    logger.info({ component: "reputation", ...fields }, event),
  );
  if (env.REPUTATION_JOBS === "inline") {
    startReputationJobs(reputation.deps);
    logger.info({ component: "reputation" }, "reputation jobs running inline (every 15 minutes)");
  }
  // $WIF elections (mainnet 4663): lookalike defence + inline indexer once SuiemElections is deployed.
  const elections = electionsRuntimeFromEnv(env);
  if (elections.deployment) {
    await assertWifIdentity(elections.client);
    logger.info(
      { component: "elections", chainId: 4663, kind: rpcLabel(env.MAINNET_RPC_URL) },
      "$WIF identity check passed",
    );
    if (env.INDEXER === "inline") {
      const log = (
        level: "info" | "warn" | "error",
        event: string,
        f: Record<string, unknown> = {},
      ) => logger[level]({ component: "indexer", ...f }, event);
      const indexer = new ElectionsIndexer({
        pool: db.pool,
        client: elections.client,
        chainId: 4663,
        contract: elections.deployment.elections,
        deployBlock: BigInt(elections.deployment.block),
        logRange: env.INDEXER_LOG_RANGE,
        log,
      });
      startIndexerLoop(indexer, env.INDEXER_POLL_MS, log);
      logger.info({ component: "indexer" }, "elections indexer running inline");
    }
  }
  const app = await createApp({
    env,
    db,
    redis,
    logger,
    clock: systemClock,
    research,
    reputation,
    elections,
  });
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  logger.info({ port: env.API_PORT, component: "boot" }, "api listening");
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- logger may not exist yet
    console.error(JSON.stringify({ level: "fatal", msg: "boot failed", ...errorFields(error) }));
    process.exit(1);
  });
}
