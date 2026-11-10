import { robinhoodMainnet } from "./robinhood-mainnet";
import { robinhoodTestnet } from "./robinhood-testnet";

export const SUIEM_CHAINS = [robinhoodMainnet, robinhoodTestnet] as const;
export type SuiemChainId = (typeof SUIEM_CHAINS)[number]["id"];
export const SUIEM_CHAIN_IDS: readonly SuiemChainId[] = [robinhoodMainnet.id, robinhoodTestnet.id];

export type NetworkKey = "mainnet" | "testnet" | "offchain";

/** ADR-0010 §1: which network each feature runs on. Code must look features up here. */
export const FEATURE_NETWORK = {
  "wif.elections": "mainnet",
  "wif.tips": "mainnet",
  "rewards.usdg_prize": "mainnet",
  "invest.stock_tokens": "testnet",
  "invest.simulated": "offchain",
  extension: "offchain",
  research: "offchain",
  theses: "offchain",
  social: "offchain",
  reputation: "offchain",
} as const satisfies Record<string, NetworkKey>;
export type Feature = keyof typeof FEATURE_NETWORK;

export const NETWORK_CHAIN_ID: Record<Exclude<NetworkKey, "offchain">, SuiemChainId> = {
  mainnet: robinhoodMainnet.id,
  testnet: robinhoodTestnet.id,
};

/** Badge text shown next to every onchain action (ADR-0010 §1). */
export const NETWORK_BADGE: Record<
  NetworkKey,
  { label: string; tone: "real" | "test" | "neutral" }
> = {
  mainnet: { label: "Mainnet · real $WIF", tone: "real" },
  testnet: { label: "Testnet · no value", tone: "test" },
  offchain: { label: "Off-chain", tone: "neutral" },
};

export function chainForFeature(feature: Feature): SuiemChainId | null {
  const network = FEATURE_NETWORK[feature];
  return network === "offchain" ? null : NETWORK_CHAIN_ID[network];
}

export function networkOfChain(chainId: number): Exclude<NetworkKey, "offchain"> | null {
  if (chainId === robinhoodMainnet.id) return "mainnet";
  if (chainId === robinhoodTestnet.id) return "testnet";
  return null;
}

export class ChainMismatchError extends Error {
  override readonly name = "ChainMismatchError";
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`RPC reports chainId ${actual}, expected ${expected}. Refusing to continue.`);
  }
}

/** Chain-ID assertion helper: pure, so it can be used by boot checks, workers and tests. */
export function assertChainId(actual: number, expected: SuiemChainId): void {
  if (actual !== expected) throw new ChainMismatchError(expected, actual);
}
