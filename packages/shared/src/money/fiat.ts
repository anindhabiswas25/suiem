import {
  type Amount,
  MoneyError,
  add,
  amount,
  formatAmount,
  parseAmount,
  rescale,
  type Rounding,
} from "./amount";

/**
 * Fiat values are stored as numeric(20,6) with an ISO-4217 currency (ARCHITECTURE §6).
 * Internally they are Amounts with 6 decimals. Mixing currencies is always an error.
 */
export const FIAT_DECIMALS = 6 as const;

/** Currencies accepted in Phase 2. Add more only with display/rounding rules. */
export type Currency = "USD" | "INR" | "EUR" | "GBP";
export const CURRENCIES: readonly Currency[] = ["USD", "INR", "EUR", "GBP"];

export interface Fiat {
  readonly amount: Amount;
  readonly currency: Currency;
}

/** numeric(20,6): at most 14 integer digits. */
const MAX_FIAT_UNITS = 10n ** 20n - 1n;

function assertCurrency(currency: string): asserts currency is Currency {
  if (!(CURRENCIES as readonly string[]).includes(currency))
    throw new MoneyError("unsupported currency");
}

export function fiat(value: string, currency: string, rounding: Rounding = "exact"): Fiat {
  assertCurrency(currency);
  const a = parseAmount(value, FIAT_DECIMALS, rounding);
  if ((a.units < 0n ? -a.units : a.units) > MAX_FIAT_UNITS)
    throw new MoneyError("exceeds numeric(20,6)");
  return Object.freeze({ amount: a, currency });
}

export function fiatFromAmount(a: Amount, currency: string, rounding: Rounding = "exact"): Fiat {
  assertCurrency(currency);
  return Object.freeze({ amount: rescale(a, FIAT_DECIMALS, rounding), currency });
}

export function addFiat(a: Fiat, b: Fiat): Fiat {
  if (a.currency !== b.currency) throw new MoneyError("cannot add different currencies");
  return Object.freeze({ amount: add(a.amount, b.amount), currency: a.currency });
}

/** Display string such as "USD 12.30". Uses 2 fraction digits minimum, never a float. */
export function formatFiat(value: Fiat): string {
  return `${value.currency} ${formatAmount(value.amount, { trimZeros: true, minFraction: 2 })}`;
}

/** Postgres numeric(20,6) text form, e.g. "12.300000". */
export function toDbNumeric(value: Fiat): string {
  return formatAmount(value.amount, { trimZeros: false });
}

export function fromDbNumeric(text: string, currency: string): Fiat {
  return fiat(text, currency, "exact");
}

export { amount };
