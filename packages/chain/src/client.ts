import {
  MAINNET_FACTS,
  robinhoodMainnet,
  robinhoodTestnet,
  TESTNET_FACTS,
  type SuiemChainId,
} from "@suiem/config/chains";
import { createPublicClient, fallback, type PublicClient } from "viem";
import { secretHttp } from "./rpc";

export interface ChainClientOptions {
  chainId: SuiemChainId;
  /** Explicit RPC override (e.g. local anvil fork in tests). */
  rpcUrl?: string;
  /** Optional Alchemy key: primary with public fallback (ADR-0002, PO OQ-PR-03). */
  alchemyApiKey?: string;
  timeoutMs?: number;
  /** Requests per second per RPC (plan limits). Default 15; 0 = unlimited. */
  maxRps?: number;
}

const BY_ID = {
  [robinhoodMainnet.id]: { chain: robinhoodMainnet, alchemy: MAINNET_FACTS.alchemyHttpBase },
  [robinhoodTestnet.id]: { chain: robinhoodTestnet, alchemy: TESTNET_FACTS.alchemyHttpBase },
} as const;

/** Ordered RPC URLs. Alchemy and QuickNode URLs contain secrets: never log them (see ./rpc). */
export function rpcUrls(options: ChainClientOptions): string[] {
  if (options.rpcUrl) return [options.rpcUrl];
  const cfg = BY_ID[options.chainId];
  const urls: string[] = [];
  if (options.alchemyApiKey) urls.push(`${cfg.alchemy}${options.alchemyApiKey}`);
  urls.push(cfg.chain.rpcUrls.default.http[0]);
  return urls;
}

/**
 * Read-only public client. No wallet client and no write path in the API (ADR-0001).
 * Every transport redacts its URL from errors and paces requests (`secretHttp`).
 */
export function createSuiemPublicClient(options: ChainClientOptions): PublicClient {
  const timeout = options.timeoutMs ?? 10_000;
  const transports = rpcUrls(options).map((url) =>
    secretHttp(url, { timeout, retryCount: 2, maxRps: options.maxRps }),
  );
  return createPublicClient({
    chain: BY_ID[options.chainId].chain,
    transport: transports.length === 1 ? transports[0]! : fallback(transports),
    cacheTime: 0,
  }) as PublicClient;
}
