import type { DemoDeployment } from "@suiem/chain/deployment";
import type { Hex, PublicClient } from "viem";

export const INVEST = Symbol("INVEST");

export interface PriceQuote {
  /** Plain decimal string as published by the provider (e.g. "168.89"). */
  price: string;
  /** Provider timestamp of the price. */
  at: Date;
  source: string;
  sourceUrl: string;
}

/** Everything the order service needs from the outside world. Tests inject anvil + fixed prices. */
export interface InvestRuntime {
  /** Public client for Robinhood Chain TESTNET (46630) only. Null: testnet trading unavailable. */
  testnet: PublicClient | null;
  deployment: DemoDeployment | null;
  /** Testnet-only EIP-712 quote signer (never used for any other chain). */
  quoteSignerKey: Hex | null;
  price(ticker: string): Promise<PriceQuote>;
  limits: {
    perOrderUsd: bigint;
    perDayUsd: bigint;
    demoFeeBps: number;
    simFeeBps: number;
    simSlippageBps: number;
    slippageBps: number;
  };
}
