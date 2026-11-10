/**
 * Decimal-safe amounts (PRD §14, §19.5). Every value is an integer count of base units (bigint)
 * plus its decimals. Floating point is forbidden in this module by an ESLint rule: no `number`
 * type, no `Number`, `Math`, `parseFloat`, `toFixed` or float literals. Inputs are decimal strings.
 */

/** Supported decimals. 0–36 covers fiat (2–6) and ERC-20 (usually 6 or 18). */
export type Decimals =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36;

export const MAX_DECIMALS: Decimals = 36;

export type Rounding = "exact" | "floor" | "ceil" | "halfEven" | "halfUp" | "truncate";

export interface Amount {
  /** Integer number of base units. */
  readonly units: bigint;
  readonly decimals: Decimals;
}

export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

/** Largest magnitude storable in Postgres numeric(78,0) (ARCHITECTURE §6). */
export const MAX_DB_UNITS = 10n ** 78n - 1n;

const DECIMAL_RE = /^(-)?(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/** `decimals` is a small integer count (not a money value), validated without float maths. */
function assertDecimals(decimals: unknown): asserts decimals is Decimals {
  if (typeof decimals !== "number" || !/^(?:[0-9]|[12][0-9]|3[0-6])$/.test(`${decimals}`)) {
    throw new MoneyError("decimals must be an integer from 0 to 36");
  }
}

function assertNotJsNumber(value: unknown, what: string): void {
  if (typeof value !== "bigint" && typeof value !== "string") {
    throw new MoneyError(`${what} must be a bigint or decimal string, never a JS number`);
  }
}

function pow10(decimals: Decimals): bigint {
  return 10n ** BigInt(decimals);
}

export function amount(units: bigint, decimals: Decimals): Amount {
  assertNotJsNumber(units, "units");
  if (typeof units !== "bigint") throw new MoneyError("units must be a bigint");
  assertDecimals(decimals);
  return Object.freeze({ units, decimals });
}

/**
 * Parses a plain decimal string ("12", "0.5", "-3.14") exactly. No exponents, no separators,
 * no leading "+" or "." and no surrounding whitespace. More fractional digits than `decimals`
 * is an error unless a rounding mode other than "exact" is given.
 */
export function parseAmount(
  input: string,
  decimals: Decimals,
  rounding: Rounding = "exact",
): Amount {
  assertNotJsNumber(input, "input");
  if (typeof input !== "string") throw new MoneyError("input must be a string");
  assertDecimals(decimals);
  const match = DECIMAL_RE.exec(input);
  if (match === null) throw new MoneyError("not a plain decimal string");
  const negative = match[1] === "-";
  const whole = match[2] ?? "0";
  const frac = match[3] ?? "";
  const scale = pow10(decimals);
  if (frac.length <= decimals) {
    const units = BigInt(whole) * scale + BigInt(frac.padEnd(decimals, "0") || "0");
    return amount(negative && units !== 0n ? -units : units, decimals);
  }
  // Too precise: parse at the input's own precision, then rescale with the requested rounding.
  const inputDecimals = frac.length;
  if (inputDecimals > 36) throw new MoneyError("too many fractional digits");
  const raw = BigInt(whole + frac);
  const exact = amount(negative ? -raw : raw, inputDecimals as Decimals);
  return rescale(exact, decimals, rounding);
}

/** Formats exactly, with no exponent and no float. `minFraction` pads trailing zeros. */
export function formatAmount(
  value: Amount,
  options: { trimZeros?: boolean; minFraction?: Decimals } = {},
): string {
  const { units, decimals } = value;
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = pow10(decimals);
  const whole = abs / scale;
  let frac = decimals === 0 ? "" : (abs % scale).toString().padStart(decimals, "0");
  if (options.trimZeros ?? true) frac = frac.replace(/0+$/, "");
  const minFraction = options.minFraction ?? 0;
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, "0");
  const body = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

/** Integer division of n by d (d > 0) with an explicit rounding mode. */
export function divRound(n: bigint, d: bigint, rounding: Rounding): bigint {
  if (d <= 0n) throw new MoneyError("divisor must be positive");
  const q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  if (rounding === "exact")
    throw new MoneyError("value is not exactly representable at this precision");
  if (rounding === "truncate") return q;
  const negative = n < 0n;
  if (rounding === "floor") return negative ? q - 1n : q;
  if (rounding === "ceil") return negative ? q : q + 1n;
  const twiceR = (r < 0n ? -r : r) * 2n;
  const awayFromZero = negative ? q - 1n : q + 1n;
  if (twiceR > d) return awayFromZero;
  if (twiceR < d) return q;
  // Exactly half.
  if (rounding === "halfUp") return awayFromZero;
  return q % 2n === 0n ? q : awayFromZero; // halfEven (banker's rounding)
}

export function rescale(value: Amount, toDecimals: Decimals, rounding: Rounding = "exact"): Amount {
  assertDecimals(toDecimals);
  if (toDecimals === value.decimals) return value;
  if (toDecimals > value.decimals) {
    return amount((value.units * pow10(toDecimals)) / pow10(value.decimals), toDecimals);
  }
  const factor = 10n ** (BigInt(value.decimals) - BigInt(toDecimals));
  return amount(divRound(value.units, factor, rounding), toDecimals);
}

function sameScale(a: Amount, b: Amount): void {
  if (a.decimals !== b.decimals)
    throw new MoneyError("amounts have different decimals; rescale explicitly");
}

export function add(a: Amount, b: Amount): Amount {
  sameScale(a, b);
  return amount(a.units + b.units, a.decimals);
}

export function sub(a: Amount, b: Amount): Amount {
  sameScale(a, b);
  return amount(a.units - b.units, a.decimals);
}

export function cmp(a: Amount, b: Amount): -1n | 0n | 1n {
  sameScale(a, b);
  return a.units < b.units ? -1n : a.units > b.units ? 1n : 0n;
}

export function isZero(a: Amount): boolean {
  return a.units === 0n;
}

/** a × numerator / denominator, rounded explicitly (e.g. fees, pro-rata splits). */
export function mulRatio(
  a: Amount,
  numerator: bigint,
  denominator: bigint,
  rounding: Rounding,
): Amount {
  assertNotJsNumber(numerator, "numerator");
  assertNotJsNumber(denominator, "denominator");
  return amount(divRound(a.units * numerator, denominator, rounding), a.decimals);
}

export function assertNonNegative(a: Amount): Amount {
  if (a.units < 0n) throw new MoneyError("amount must not be negative");
  return a;
}

/** Serialises base units for a Postgres numeric(78,0) column. */
export function toDbUnits(a: Amount): string {
  const abs = a.units < 0n ? -a.units : a.units;
  if (abs > MAX_DB_UNITS) throw new MoneyError("amount exceeds numeric(78,0)");
  return a.units.toString();
}

export function fromDbUnits(units: string, decimals: Decimals): Amount {
  if (!/^-?[0-9]+$/.test(units)) throw new MoneyError("database value is not an integer string");
  return amount(BigInt(units), decimals);
}
