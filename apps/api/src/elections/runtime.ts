import { createSuiemPublicClient } from "@suiem/chain";
import { type ElectionsDeployment, loadElectionsDeployment } from "@suiem/chain/elections";
import type { ApiEnv } from "@suiem/config/env";
import type { PublicClient } from "viem";

export const ELECTIONS = Symbol("ELECTIONS");

/**
 * Mainnet 4663 access for elections: the server-side client (QuickNode via MAINNET_RPC_URL; the
 * URL is a secret and never reaches the web app) and the SuiemElections deployment manifest.
 * `deployment` is null until the contract is deployed: read routes then list nothing and the vote
 * preview answers 503-style CONFLICT.
 */
export interface ElectionsRuntime {
  client: PublicClient;
  deployment: ElectionsDeployment | null;
}

export function electionsRuntimeFromEnv(env: ApiEnv): ElectionsRuntime {
  return {
    client: createSuiemPublicClient({
      chainId: 4663,
      rpcUrl: env.MAINNET_RPC_URL,
      alchemyApiKey: env.ALCHEMY_API_KEY,
      maxRps: env.RPC_MAX_RPS,
      timeoutMs: 10_000,
    }),
    deployment: loadElectionsDeployment(),
  };
}
