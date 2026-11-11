/**
 * Standalone indexer entry point (when the API runs with INDEXER=off).
 *   pnpm --filter @suiem/indexer start
 * Uses MAINNET_RPC_URL (secret, never logged) and deployments/4663.json.
 */
import { assertSuiemChain, createSuiemPublicClient } from "@suiem/chain";
import { assertWifIdentity, loadElectionsDeployment } from "@suiem/chain/elections";
import { connect } from "@suiem/db";
import { ElectionsIndexer, startIndexerLoop } from "./indexer";

const env = process.env;
const log = (level: string, event: string, fields: Record<string, unknown> = {}) =>
  // eslint-disable-next-line no-console -- standalone worker logs JSON lines to stdout
  console.log(JSON.stringify({ level, msg: event, service: "suiem-indexer", ...fields }));

const deployment = loadElectionsDeployment();
if (!deployment) {
  log("info", "no deployments/4663.json: nothing to index");
  process.exit(0);
}
const client = createSuiemPublicClient({
  chainId: 4663,
  rpcUrl: env.MAINNET_RPC_URL || undefined,
  maxRps: Number(env.RPC_MAX_RPS ?? 15),
});
await assertSuiemChain(client, 4663);
await assertWifIdentity(client);
const db = connect(env.DATABASE_URL!, { applicationName: "suiem-indexer" });
const indexer = new ElectionsIndexer({
  pool: db.pool,
  client,
  chainId: 4663,
  contract: deployment.elections,
  deployBlock: BigInt(deployment.block),
  logRange: Number(env.INDEXER_LOG_RANGE ?? 5000),
  log,
});
startIndexerLoop(indexer, Number(env.INDEXER_POLL_MS ?? 12_000), log);
log("info", "indexer running", { kind: deployment.elections });
