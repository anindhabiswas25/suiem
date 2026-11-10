import { MoneyError, add, amount, formatAmount, parseAmount, rescale } from "./amount";
/**
 * Fiat values are stored as numeric(20,6) with an ISO-4217 currency (ARCHITECTURE §6).
 * Internally they are Amounts with 6 decimals. Mixing currencies is always an error.
 */
export const FIAT_DECIMALS = 6;
/** Currencies accepted in Phase 2. Add more only with display/rounding rules. */
export const CURRENCIES = ["USD", "INR", "EUR", "GBP"];
/** numeric(20,6): at most 14 integer digits. */
const MAX_FIAT_UNITS = 10n ** 20n - 1n;
function assertCurrency(currency) {
  if (!CURRENCIES.includes(currency)) throw new MoneyError("unsupported currency");
}
export function fiat(value, currency, rounding = "exact") {
  assertCurrency(currency);
  const a = parseAmount(value, FIAT_DECIMALS, rounding);
  if ((a.units < 0n ? -a.units : a.units) > MAX_FIAT_UNITS)
    throw new MoneyError("exceeds numeric(20,6)");
  return Object.freeze({ amount: a, currency });
}
export function fiatFromAmount(a, currency, rounding = "exact") {
  assertCurrency(currency);
  return Object.freeze({ amount: rescale(a, FIAT_DECIMALS, rounding), currency });
}
export function addFiat(a, b) {
  if (a.currency !== b.currency) throw new MoneyError("cannot add different currencies");
  return Object.freeze({ amount: add(a.amount, b.amount), currency: a.currency });
}
/** Display string such as "USD 12.30". Uses 2 fraction digits minimum, never a float. */
export function formatFiat(value) {
  return `${value.currency} ${formatAmount(value.amount, { trimZeros: true, minFraction: 2 })}`;
}
/** Postgres numeric(20,6) text form, e.g. "12.300000". */
export function toDbNumeric(value) {
  return formatAmount(value.amount, { trimZeros: false });
}
export function fromDbNumeric(text, currency) {
  return fiat(text, currency, "exact");
}
export { amount };
