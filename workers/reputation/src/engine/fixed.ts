/**
 * Integer fixed-point helpers for the score engine. No floating point anywhere: ratios are
 * ppm (1.0 = 1_000_000n) and points are micro-points (1 point = 1_000_000n). Rounding is
 * explicit (half-even) through the shared decimal library.
 */
import { divRound, formatAmount, rescale, amount } from "@suiem/shared/money";

export const PPM = 1_000_000n;
export const POINT = 1_000_000n;
export const HUNDRED = 100n * POINT;

export function clamp(v: bigint, lo: bigint, hi: bigint): bigint {
  return v < lo ? lo : v > hi ? hi : v;
}

/** n / d rounded half-even (d > 0). */
export function div(n: bigint, d: bigint): bigint {
  return divRound(n, d, "halfEven");
}

/** Points (micro) from a ratio in ppm: 0.5 → 50 points. */
export function pointsFromPpm(ppm: bigint): bigint {
  return clamp(ppm * 100n, 0n, HUNDRED);
}

/** Integer square root (floor) for non-negative bigints (Newton's method). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of a negative number");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Ratio a/b in ppm, half-even. */
export function ratioPpm(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("ratio with zero denominator");
  return div(a * PPM, b);
}

/** Weighted average of micro-point scores with integer percentage weights summing to 100. */
export function weighted(parts: { points: bigint; weight: number }[]): bigint {
  let total = 0n;
  let weights = 0n;
  for (const p of parts) {
    total += p.points * BigInt(p.weight);
    weights += BigInt(p.weight);
  }
  if (weights !== 100n) throw new Error(`weights must sum to 100, got ${weights}`);
  return div(total, 100n);
}

/** Micro-points → "57.25" (2 decimals, half-even). */
export function formatPoints(micro: bigint): string {
  return formatAmount(rescale(amount(micro, 6), 2, "halfEven"), { trimZeros: false });
}

/** ppm → "12.3456%" style decimal string of the ratio itself ("0.123456"). */
export function formatPpm(ppm: bigint): string {
  return formatAmount(amount(ppm, 6), { trimZeros: false });
}
