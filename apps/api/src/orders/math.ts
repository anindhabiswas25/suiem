/**
 * Order and portfolio arithmetic. bigint only: no floats, no Number conversions of amounts
 * (PRD §19.5; the ESLint money rules apply to this directory).
 *
 * Units: USD / dUSD amounts have 6 decimals; token quantities have 18 decimals; prices are USD
 * base units (6 decimals) per one whole token (1e18 base units).
 */
import { amount, divRound, formatAmount, parseAmount } from "@suiem/shared/money";

export const USD_DECIMALS = 6 as const;
export const QTY_DECIMALS = 18 as const;
export const ONE_TOKEN = 10n ** 18n;
const BPS = 10_000n;
/** Basis points are small integers (0–1000), not money. */
// eslint-disable-next-line no-restricted-syntax -- bps are integer config values, converted to bigint before any arithmetic
export type Bps = number;

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

/** Parses a user-entered decimal string ("100", "0.25") into base units exactly. */
export function toUnits(value: string, decimals: 6 | 18): bigint {
  return parseAmount(value, decimals).units;
}
export function fromUnits(units: bigint, decimals: 6 | 18): string {
  return formatAmount(amount(units, decimals), { trimZeros: true });
}

/** A provider price string ("168.89") → USD base units per token, rounded half-even to 6 dp. */
export function priceToUnits(price: string): bigint {
  return parseAmount(price, USD_DECIMALS, "halfEven").units;
}

/** USD value (6 dp) of a quantity (18 dp) at a price (6 dp per token), rounded down. */
export function valueOf(quantity: bigint, price: bigint): bigint {
  return (quantity * price) / ONE_TOKEN;
}

/** Same rounding as SuiemDemoVenue.previewOut (toward the venue). */
export function tradeOut(
  side: "buy" | "sell",
  amountIn: bigint,
  price: bigint,
  feeBps: Bps,
): { out: bigint; fee: bigint } {
  const bps = BigInt(feeBps);
  if (side === "buy") {
    const fee = ceilDiv(amountIn * bps, BPS);
    return { out: ((amountIn - fee) * ONE_TOKEN) / price, fee };
  }
  const gross = (amountIn * price) / ONE_TOKEN;
  const fee = ceilDiv(gross * bps, BPS);
  return { out: gross - fee, fee };
}

/** Simulated execution price: slippage always against the trader (disclosed model). */
export function simulatedPrice(side: "buy" | "sell", price: bigint, slippageBps: Bps): bigint {
  const s = BigInt(slippageBps);
  return side === "buy" ? ceilDiv(price * (BPS + s), BPS) : (price * (BPS - s)) / BPS;
}

/** Slippage bound: the least output the trader accepts (rounded down). */
export function minOutFor(out: bigint, slippageBps: Bps): bigint {
  return (out * (BPS - BigInt(slippageBps))) / BPS;
}

export interface Fill {
  side: "buy" | "sell";
  /** Token quantity bought or sold (18 dp). */
  quantity: bigint;
  /** USD paid (buy, incl. fee) or received (sell, net of fee), 6 dp. */
  cash: bigint;
}
export interface PositionState {
  quantity: bigint;
  /** Average-cost basis of the open quantity, 6 dp (fees included in cost). */
  costBasis: bigint;
  /** Realized P&L so far, 6 dp. */
  realized: bigint;
}

/**
 * Average-cost method (documented on the Help page): buys add quantity and their full cash cost
 * (fees included); a sell removes cost in proportion to the quantity sold (rounded half-even), and
 * realized P&L = cash received − cost removed.
 */
export function applyFill(p: PositionState, f: Fill): PositionState {
  if (f.side === "buy")
    return {
      quantity: p.quantity + f.quantity,
      costBasis: p.costBasis + f.cash,
      realized: p.realized,
    };
  if (f.quantity > p.quantity) throw new Error("sell exceeds position");
  const removed =
    p.quantity === f.quantity
      ? p.costBasis
      : divRound(p.costBasis * f.quantity, p.quantity, "halfEven");
  return {
    quantity: p.quantity - f.quantity,
    costBasis: p.costBasis - removed,
    realized: p.realized + (f.cash - removed),
  };
}

export const replay = (fills: Fill[]): PositionState =>
  fills.reduce(applyFill, { quantity: 0n, costBasis: 0n, realized: 0n });

/** Average cost per whole token (6 dp), or null with no position. */
export function averageCost(p: PositionState): bigint | null {
  return p.quantity === 0n ? null : divRound(p.costBasis * ONE_TOKEN, p.quantity, "halfEven");
}
