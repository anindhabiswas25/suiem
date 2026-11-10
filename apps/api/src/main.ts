import { createSuiemPublicClient, assertSuiemChain } from "@suiem/chain";
import { robinhoodMainnet, robinhoodTestnet } from "@suiem/config/chains";
import { loadApiEnv } from "@suiem/config/env";
import { connect } from "@suiem/db";
import { createApp } from "./app";
import { createRedis } from "./infra/redis";
import { createLogger } from "./observability/logger";
import { errorFields } from "./observability/redact";
import { systemClock } from "./tokens";

/** Boot: validate env, check both chains report the expected IDs, then serve. */
export async function bootstrap(source: Record<string, string | undefined> = process.env) {
  const env = loadApiEnv(source);
  const logger = createLogger({ level: env.LOG_LEVEL, service: "suiem-api", env: env.NODE_ENV });
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
  const app = await createApp({ env, db, redis, logger, clock: systemClock });
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
