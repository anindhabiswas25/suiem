import { createSuiemPublicClient } from "@suiem/chain";
import { loadDemoDeployment } from "@suiem/chain/deployment";
import { assertTestnet } from "@suiem/chain/write";
import type { ApiEnv } from "@suiem/config/env";
import type { Hex } from "viem";
import type { ResearchRuntime } from "../research/runtime";
import type { InvestRuntime } from "./runtime";

/** Builds the invest runtime from env: testnet client (46630 only), deployment manifest, signer, Finnhub prices. */
export function investRuntimeFromEnv(env: ApiEnv, research: ResearchRuntime): InvestRuntime {
  assertTestnet(46630);
  const testnet =
    env.TESTNET_RPC_URL || env.ALCHEMY_API_KEY
      ? createSuiemPublicClient({
          chainId: 46630,
          rpcUrl: env.TESTNET_RPC_URL,
          alchemyApiKey: env.ALCHEMY_API_KEY,
          timeoutMs: 10_000,
        })
      : null;
  return {
    testnet,
    deployment: loadDemoDeployment(env.DEMO_DEPLOYMENT_FILE),
    quoteSignerKey: (env.QUOTE_SIGNER_PRIVATE_KEY as Hex | undefined) ?? null,
    async price(ticker) {
      if (!research.market) throw new Error("market data not configured");
      const q = await research.market.quote(ticker);
      if (!q.data.t || !(q.data.c > 0)) throw new Error("no quote");
      // Provider boundary: Finnhub returns a JSON number; String() keeps its shortest exact decimal form.
      return {
        price: String(q.data.c),
        at: new Date(q.data.t * 1000),
        source: "Finnhub (free tier)",
        sourceUrl: "https://finnhub.io/docs/api/quote",
      };
    },
    limits: {
      perOrderUsd: BigInt(env.ORDER_MAX_USD_PER_ORDER),
      perDayUsd: BigInt(env.ORDER_MAX_USD_PER_DAY),
      demoFeeBps: env.DEMO_FEE_BPS,
      simFeeBps: env.SIM_FEE_BPS,
      simSlippageBps: env.SIM_SLIPPAGE_BPS,
      slippageBps: env.ORDER_MAX_SLIPPAGE_BPS,
    },
  };
}
