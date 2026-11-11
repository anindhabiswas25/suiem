import { demoStockTokenAbi, demoUSDAbi, suiemDemoVenueAbi } from "@suiem/chain/abi";
import {
  decodeTrade,
  DEMO_CHAIN_ID,
  encodeApprove,
  encodeTrade,
  previewHash,
  signQuote,
} from "@suiem/chain/write";
import { randomBytes } from "node:crypto";
import { type Address, decodeEventLog, getAddress, type Hex } from "viem";
import { minOutFor, simulatedPrice, tradeOut } from "./math";
import type { InvestRuntime, PriceQuote } from "./runtime";

/**
 * Venue adapters (PRD §13.3 order-service boundary). There is NO live adapter: `trading.live` is
 * hard-off in the database and the `book` domain rejects 'live'.
 */
export interface VenueQuote {
  price: bigint;
  quote: PriceQuote;
  expiresAt: Date;
}
export interface VenuePreview {
  amountIn: bigint;
  out: bigint;
  fee: bigint;
  minOut: bigint;
  executionPrice: bigint;
  feeBps: number;
  /** Testnet only: what the wallet must send, and the binding hash. */
  tx: { chainId: number; to: Address; data: Hex; value: "0" } | null;
  nonce: bigint | null;
  previewHash: Hex;
}
export interface VenueAdapter {
  readonly book: "simulated" | "testnet";
  quote(ticker: string, now: Date): Promise<VenueQuote>;
  preview(input: {
    side: "buy" | "sell";
    amountIn: bigint;
    quote: VenueQuote;
    trader: Address | null;
    token: Address | null;
  }): Promise<VenuePreview>;
}

/**
 * Quotes are valid for 55 s: the venue rejects expiries more than 60 s past block.timestamp, and
 * chain time can trail the server clock by a few seconds.
 */
export const QUOTE_TTL_MS = 55_000;

async function fetchQuote(
  rt: InvestRuntime,
  ticker: string,
  now: Date,
  toUnits: (p: string) => bigint,
): Promise<VenueQuote> {
  const q = await rt.price(ticker);
  const price = toUnits(q.price);
  if (price <= 0n) throw new Error("no usable price");
  return { price, quote: q, expiresAt: new Date(now.getTime() + QUOTE_TTL_MS) };
}

/** Paper trading at the provider quote with a disclosed fee and slippage model. Offchain. */
export class SimulatedVenue implements VenueAdapter {
  readonly book = "simulated" as const;
  constructor(
    private readonly rt: InvestRuntime,
    private readonly toUnits: (p: string) => bigint,
  ) {}
  quote(ticker: string, now: Date) {
    return fetchQuote(this.rt, ticker, now, this.toUnits);
  }
  async preview({
    side,
    amountIn,
    quote,
  }: Parameters<VenueAdapter["preview"]>[0]): Promise<VenuePreview> {
    const executionPrice = simulatedPrice(side, quote.price, this.rt.limits.simSlippageBps);
    const { out, fee } = tradeOut(side, amountIn, executionPrice, this.rt.limits.simFeeBps);
    const nonce = BigInt(`0x${randomBytes(16).toString("hex")}`);
    // Simulated orders have no transaction; the preview hash binds the economic terms instead.
    const data =
      `0x${side === "buy" ? "01" : "02"}${amountIn.toString(16).padStart(64, "0")}${executionPrice.toString(16).padStart(64, "0")}${nonce.toString(16).padStart(64, "0")}` as Hex;
    return {
      amountIn,
      out,
      fee,
      minOut: out,
      executionPrice,
      feeBps: this.rt.limits.simFeeBps,
      tx: null,
      nonce: null,
      previewHash: previewHash(DEMO_CHAIN_ID, "0x0000000000000000000000000000000000000000", data),
    };
  }
}

/** Real testnet transactions the user signs, against SuiemDemoVenue on 46630. */
export class TestnetDemoVenue implements VenueAdapter {
  readonly book = "testnet" as const;
  constructor(
    private readonly rt: InvestRuntime,
    private readonly toUnits: (p: string) => bigint,
  ) {}

  get venue(): Address {
    return this.rt.deployment!.venue;
  }

  quote(ticker: string, now: Date) {
    return fetchQuote(this.rt, ticker, now, this.toUnits);
  }

  async preview({
    side,
    amountIn,
    quote,
    trader,
    token,
  }: Parameters<VenueAdapter["preview"]>[0]): Promise<VenuePreview> {
    if (!trader || !token || !this.rt.quoteSignerKey)
      throw new Error("testnet venue not configured");
    const feeBps = this.rt.limits.demoFeeBps;
    const { out, fee } = tradeOut(side, amountIn, quote.price, feeBps);
    const minOut = minOutFor(out, this.rt.limits.slippageBps);
    const nonce = BigInt(`0x${randomBytes(16).toString("hex")}`);
    const q = {
      trader,
      token,
      side: side === "buy" ? 0 : 1,
      amountIn,
      price: quote.price,
      feeBps,
      expiry: BigInt(Math.floor(quote.expiresAt.getTime() / 1000)),
      nonce,
    } as const;
    const signature = await signQuote(this.rt.quoteSignerKey, DEMO_CHAIN_ID, this.venue, q);
    const data = encodeTrade(q, signature, minOut);
    return {
      amountIn,
      out,
      fee,
      minOut,
      executionPrice: quote.price,
      feeBps,
      tx: { chainId: DEMO_CHAIN_ID, to: this.venue, data, value: "0" },
      nonce,
      previewHash: previewHash(DEMO_CHAIN_ID, this.venue, data, 0n),
    };
  }

  // ---- chain reads (testnet only) -----------------------------------------------------------
  private get client() {
    if (!this.rt.testnet) throw new Error("testnet RPC not configured");
    return this.rt.testnet;
  }
  balanceOf(token: Address, owner: Address) {
    return this.client.readContract({
      address: token,
      abi: demoStockTokenAbi,
      functionName: "balanceOf",
      args: [owner],
    });
  }
  dusdBalance(owner: Address) {
    return this.client.readContract({
      address: this.rt.deployment!.dusd,
      abi: demoUSDAbi,
      functionName: "balanceOf",
      args: [owner],
    });
  }
  dusdAllowance(owner: Address) {
    return this.client.readContract({
      address: this.rt.deployment!.dusd,
      abi: demoUSDAbi,
      functionName: "allowance",
      args: [owner, this.venue],
    });
  }
  paused() {
    return this.client.readContract({
      address: this.venue,
      abi: suiemDemoVenueAbi,
      functionName: "paused",
    });
  }
  /** eth_call simulation of exactly the calldata the user will sign. Returns a revert reason or null. */
  async simulate(trader: Address, data: Hex): Promise<string | null> {
    try {
      await this.client.call({ account: trader, to: this.venue, data, blockTag: "pending" });
      return null;
    } catch (e) {
      return (e as { shortMessage?: string }).shortMessage ?? "simulation reverted";
    }
  }
  approval(amount: bigint) {
    return {
      token: this.rt.deployment!.dusd,
      spender: this.venue,
      amount,
      data: encodeApprove(this.venue, amount),
    };
  }

  /** Server-side reconciliation input: the transaction, its receipt and the venue's Trade event. */
  async inspect(txHash: Hex) {
    const tx = await this.client.getTransaction({ hash: txHash }).catch(() => null);
    if (!tx) return { state: "unknown" as const };
    const binding = tx.to
      ? previewHash(DEMO_CHAIN_ID, getAddress(tx.to), tx.input, tx.value)
      : null;
    const receipt = await this.client.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) return { state: "pending" as const, from: getAddress(tx.from), binding };
    const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    const base = {
      from: getAddress(tx.from),
      binding,
      blockNumber: receipt.blockNumber,
      timestamp: new Date(Number(block.timestamp) * 1000),
    };
    if (receipt.status !== "success") return { state: "reverted" as const, ...base };
    // Only logs emitted BY the venue count (a lookalike event from another contract is ignored).
    const trades = receipt.logs
      .filter((l) => getAddress(l.address) === this.venue)
      .flatMap((l) => {
        try {
          const ev = decodeEventLog({ abi: suiemDemoVenueAbi, data: l.data, topics: l.topics });
          return ev.eventName === "Trade"
            ? [
                {
                  args: ev.args as {
                    trader: Address;
                    token: Address;
                    side: number;
                    amountIn: bigint;
                    amountOut: bigint;
                    price: bigint;
                    fee: bigint;
                    nonce: bigint;
                  },
                  logIndex: l.logIndex,
                },
              ]
            : [];
        } catch {
          return [];
        }
      });
    return { state: "mined" as const, ...base, trades };
  }

  decode(data: Hex) {
    return decodeTrade(data);
  }
}
