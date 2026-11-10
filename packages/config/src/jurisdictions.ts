/**
 * Stock Token restricted jurisdictions (hackathon rule 5, VERIFIED_FACTS J-01).
 * Source: https://docs.robinhood.com/rhj/restricted-jurisdictions (PO-supplied 2026-11-10; re-read in S5-01).
 * ISO-3166-1 alpha-2 codes.
 */
export const STOCK_TOKEN_RESTRICTED = [
  "US", // United States
  "CA", // Canada
  "GB", // United Kingdom
  "CH", // Switzerland
  "CU", // Cuba
  "BY", // Belarus
  "IR", // Iran
  "KP", // North Korea
  "RU", // Russia
  "SY", // Syria
  "UA", // Ukraine
  "SS", // South Sudan
  "SD", // Sudan
  "MM", // Myanmar
  "VE", // Venezuela
] as const;

export type StockTokenEligibility =
  | { eligible: true }
  | { eligible: false; reason: "restricted_jurisdiction" | "jurisdiction_not_declared" };

/** Server-side check for every Stock Token route. Undeclared jurisdiction is treated as blocked. */
export function stockTokenEligibility(
  jurisdiction: string | null | undefined,
): StockTokenEligibility {
  if (!jurisdiction || !/^[A-Z]{2}$/.test(jurisdiction) || jurisdiction === "ZZ") {
    return { eligible: false, reason: "jurisdiction_not_declared" };
  }
  if ((STOCK_TOKEN_RESTRICTED as readonly string[]).includes(jurisdiction)) {
    return { eligible: false, reason: "restricted_jurisdiction" };
  }
  return { eligible: true };
}
