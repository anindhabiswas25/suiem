/**
 * Thesis evaluation (PO decision): at the end of its horizon, the FROZEN version 1 of
 * a thesis is checked: was the direction right on return relative to the benchmark (SPY)?
 * Pure: prices in, verdict out. Prices are decimal strings; arithmetic is integer (ppm).
 */
import { parseAmount } from "@suiem/shared/money";
import { div, PPM } from "./fixed";

export interface EvaluationInput {
  direction: "bullish" | "bearish" | "neutral";
  startPrice: string | null;
  endPrice: string | null;
  benchmarkStart: string | null;
  benchmarkEnd: string | null;
  neutralBandPpm: bigint;
}

export type EvaluationResult =
  | {
      status: "evaluated";
      instrumentReturnPpm: bigint;
      benchmarkReturnPpm: bigint;
      relativeReturnPpm: bigint;
      correct: boolean;
    }
  | { status: "unevaluable"; reason: string };

const units = (s: string) => parseAmount(s, 6, "halfEven").units;

/** (end − start) / start in ppm. */
export function returnPpm(start: string, end: string): bigint {
  const a = units(start);
  if (a <= 0n) throw new Error("start price must be positive");
  return div((units(end) - a) * PPM, a);
}

export function evaluateThesis(i: EvaluationInput): EvaluationResult {
  if (!i.startPrice)
    return { status: "unevaluable", reason: "No price was recorded when the thesis was written" };
  if (!i.endPrice)
    return { status: "unevaluable", reason: "No price is available at the end of the horizon" };
  if (!i.benchmarkStart || !i.benchmarkEnd)
    return { status: "unevaluable", reason: "No SPY benchmark price covers the thesis window" };
  const r = returnPpm(i.startPrice, i.endPrice);
  const b = returnPpm(i.benchmarkStart, i.benchmarkEnd);
  const rel = r - b;
  const correct =
    i.direction === "bullish"
      ? rel > 0n
      : i.direction === "bearish"
        ? rel < 0n
        : (rel < 0n ? -rel : rel) <= i.neutralBandPpm;
  return {
    status: "evaluated",
    instrumentReturnPpm: r,
    benchmarkReturnPpm: b,
    relativeReturnPpm: rel,
    correct,
  };
}
