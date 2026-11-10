import {
  MAINNET_FACTS,
  robinhoodMainnet,
  robinhoodTestnet,
  TESTNET_FACTS,
  type SuiemChainId,
} from "@suiem/config/chains";
import { createPublicClient, fallback, http, type PublicClient } from "viem";

export interface ChainClientOptions {
  chainId: SuiemChainId;
  /** Explicit RPC override (e.g. local anvil fork in tests). */
  rpcUrl?: string;
  /** Optional Alchemy key: primary with public fallback (ADR-0002, PO OQ-PR-03). */
  alchemyApiKey?: string;
  timeoutMs?: number;
}

const BY_ID = {
  [robinhoodMainnet.id]: { chain: robinhoodMainnet, alchemy: MAINNET_FACTS.alchemyHttpBase },
  [robinhoodTestnet.id]: { chain: robinhoodTestnet, alchemy: TESTNET_FACTS.alchemyHttpBase },
} as const;

/** Ordered RPC URLs. Alchemy URLs contain the key: never log them. */
export function rpcUrls(options: ChainClientOptions): string[] {
  if (options.rpcUrl) return [options.rpcUrl];
  const cfg = BY_ID[options.chainId];
  const urls: string[] = [];
  if (options.alchemyApiKey) urls.push(`${cfg.alchemy}${options.alchemyApiKey}`);
  urls.push(cfg.chain.rpcUrls.default.http[0]);
  return urls;
}

/** Read-only public client. No wallet client and no write path in the API (ADR-0001). */
export function createSuiemPublicClient(options: ChainClientOptions): PublicClient {
  const timeout = options.timeoutMs ?? 10_000;
  const transports = rpcUrls(options).map((url) => http(url, { timeout, retryCount: 1 }));
  return createPublicClient({
    chain: BY_ID[options.chainId].chain,
    transport: transports.length === 1 ? transports[0]! : fallback(transports),
    cacheTime: 0,
  }) as PublicClient;
}
