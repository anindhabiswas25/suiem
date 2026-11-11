import { amount, divRound, formatAmount } from "@suiem/shared/money";
import { filingIndexUrl } from "./providers/edgar";
import type { EdgarCompanyFacts, EdgarFactPoint, FinnhubMetrics } from "./providers/types";

/**
 * Financial highlights are computed HERE from EDGAR XBRL facts (PRD §7.2: the model never
 * computes or invents figures). Values are integer USD strings; ratios use bigint arithmetic
 * from @suiem/shared/money (no floating point).
 */
export interface Figure {
  metric: string;
  label: string;
  /** Decimal string (USD integers or a percentage with one decimal). */
  value: string;
  unit: "USD" | "%" | "x" | "USD millions" | "USD per share";
  currency: string | null;
  period: string;
  asOf: string;
  basis: "reported" | "estimated" | "calculated";
  formula: string | null;
  /** Public page a human can open (SEC filing index). */
  url: string;
  accession: string | null;
  /** Human text, e.g. "Revenue was USD 215.94 billion in FY2026 (ended 2026-01-25)". */
  text: string;
}

export interface Highlights {
  figures: Figure[];
  fiscalYear: string | null;
  periodEnd: string | null;
  filed: string | null;
  accession: string | null;
  missing: string[];
  hasFacts: boolean;
}

const REVENUE = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
] as const;
const COST = ["CostOfRevenue", "CostOfGoodsAndServicesSold"] as const;
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F", "10-K/A"]);

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

function points(facts: EdgarCompanyFacts, concept: string): EdgarFactPoint[] {
  return facts.facts["us-gaap"]?.[concept]?.units.USD ?? [];
}

/** Latest annual (≈ 1-year duration) value ending on `end` (or the latest available if end is null). */
function annual(
  facts: EdgarCompanyFacts,
  concept: string,
  end?: string | null,
): EdgarFactPoint | undefined {
  const candidates = points(facts, concept).filter(
    (p) =>
      ANNUAL_FORMS.has(p.form) &&
      p.start &&
      days(p.start, p.end) > 330 &&
      days(p.start, p.end) < 400 &&
      (!end || p.end === end),
  );
  return candidates.sort((a, b) =>
    a.end === b.end ? b.filed.localeCompare(a.filed) : b.end.localeCompare(a.end),
  )[0];
}

/** Balance-sheet (instant) value at `end`, from the latest filing that reports it. */
function instant(
  facts: EdgarCompanyFacts,
  concept: string,
  end: string,
): EdgarFactPoint | undefined {
  return points(facts, concept)
    .filter((p) => !p.start && p.end === end && ANNUAL_FORMS.has(p.form))
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
}

function big(p: EdgarFactPoint): bigint {
  if (!Number.isSafeInteger(p.val)) throw new Error("non-integer XBRL value");
  return BigInt(p.val);
}

/** "215938000000" → "215.94 billion" (bigint, half-even). */
export function humanUsd(value: bigint): string {
  const abs = value < 0n ? -value : value;
  const sign = value < 0n ? "-" : "";
  const scale =
    abs >= 1_000_000_000n
      ? [1_000_000_000n, "billion"]
      : abs >= 1_000_000n
        ? [1_000_000n, "million"]
        : [1n, ""];
  const scaled = amount(divRound(abs * 100n, scale[0] as bigint, "halfEven"), 2);
  return `${sign}${formatAmount(scaled, { trimZeros: false })}${scale[1] ? ` ${scale[1]}` : ""}`;
}

/** Percentage with one decimal: num / den × 100. */
export function percent(num: bigint, den: bigint): string {
  if (den === 0n) throw new Error("division by zero");
  return formatAmount(amount(divRound(num * 1000n, den, "halfEven"), 1), { trimZeros: false });
}

export function computeHighlights(cik: string, facts: EdgarCompanyFacts | null): Highlights {
  const empty = (missing: string[]): Highlights => ({
    figures: [],
    fiscalYear: null,
    periodEnd: null,
    filed: null,
    accession: null,
    missing,
    hasFacts: false,
  });
  if (!facts || Object.keys(facts.facts["us-gaap"] ?? {}).length === 0) {
    return empty([
      "No US-GAAP XBRL facts (e.g. a foreign filer reporting under IFRS): financial highlights unavailable",
    ]);
  }
  // The revenue concept with the most recent annual period anchors the fiscal year.
  const rev = REVENUE.map((c) => ({ c, p: annual(facts, c) }))
    .filter((x): x is { c: (typeof REVENUE)[number]; p: EdgarFactPoint } => !!x.p)
    .sort((a, b) => b.p.end.localeCompare(a.p.end))[0];
  if (!rev) return { ...empty(["Revenue not reported in annual XBRL facts"]), hasFacts: true };

  const end = rev.p.end;
  const fy = `FY${rev.p.fy ?? end.slice(0, 4)}`;
  const accn = rev.p.accn;
  const url = filingIndexUrl(cik, accn);
  const figures: Figure[] = [];
  const missing: string[] = [];
  const period = `${fy} (fiscal year ended ${end})`;
  const base = { currency: "USD", period, asOf: end, url, accession: accn };

  const revenue = big(rev.p);
  figures.push({
    ...base,
    metric: "revenue",
    label: "Revenue",
    value: revenue.toString(),
    unit: "USD",
    basis: "reported",
    formula: null,
    text: `Revenue was USD ${humanUsd(revenue)} in ${period}.`,
  });

  const gpFact = annual(facts, "GrossProfit", end);
  const costFact = COST.map((c) => annual(facts, c, end)).find(Boolean);
  let grossProfit: bigint | null = null;
  if (gpFact) {
    grossProfit = big(gpFact);
    figures.push({
      ...base,
      metric: "gross_profit",
      label: "Gross profit",
      value: grossProfit.toString(),
      unit: "USD",
      basis: "reported",
      formula: null,
      text: `Gross profit was USD ${humanUsd(grossProfit)} in ${period}.`,
    });
  } else if (costFact) {
    grossProfit = revenue - big(costFact);
    figures.push({
      ...base,
      metric: "gross_profit",
      label: "Gross profit",
      value: grossProfit.toString(),
      unit: "USD",
      basis: "calculated",
      formula: "Revenue − Cost of revenue",
      text: `Gross profit was USD ${humanUsd(grossProfit)} in ${period} (revenue minus cost of revenue).`,
    });
  } else missing.push("Gross profit");
  if (grossProfit !== null && revenue > 0n) {
    const gm = percent(grossProfit, revenue);
    figures.push({
      ...base,
      currency: null,
      metric: "gross_margin",
      label: "Gross margin",
      value: gm,
      unit: "%",
      basis: "calculated",
      formula: "Gross profit ÷ Revenue × 100",
      text: `Gross margin was ${gm}% in ${period}.`,
    });
  }

  const flows: [string, string, string][] = [
    ["OperatingIncomeLoss", "operating_income", "Operating income"],
    ["NetIncomeLoss", "net_income", "Net income"],
    ["NetCashProvidedByUsedInOperatingActivities", "operating_cash_flow", "Operating cash flow"],
  ];
  for (const [concept, metric, label] of flows) {
    const f = annual(facts, concept, end);
    if (!f) {
      missing.push(label);
      continue;
    }
    const v = big(f);
    figures.push({
      ...base,
      metric,
      label,
      value: v.toString(),
      unit: "USD",
      basis: "reported",
      formula: null,
      text: `${label} was USD ${humanUsd(v)} in ${period}.`,
    });
  }

  const cash = instant(facts, "CashAndCashEquivalentsAtCarryingValue", end);
  if (cash) {
    const v = big(cash);
    figures.push({
      ...base,
      period: `As of ${end}`,
      metric: "cash",
      label: "Cash and cash equivalents",
      value: v.toString(),
      unit: "USD",
      basis: "reported",
      formula: null,
      text: `Cash and cash equivalents were USD ${humanUsd(v)} as of ${end}.`,
    });
  } else missing.push("Cash and cash equivalents");

  const ltd = instant(facts, "LongTermDebt", end);
  const nonCurrent = instant(facts, "LongTermDebtNoncurrent", end);
  const current = instant(facts, "LongTermDebtCurrent", end) ?? instant(facts, "DebtCurrent", end);
  if (ltd) {
    const v = big(ltd);
    figures.push({
      ...base,
      period: `As of ${end}`,
      metric: "total_debt",
      label: "Total long-term debt",
      value: v.toString(),
      unit: "USD",
      basis: "reported",
      formula: null,
      text: `Total long-term debt was USD ${humanUsd(v)} as of ${end}.`,
    });
  } else if (nonCurrent) {
    const v = big(nonCurrent) + (current ? big(current) : 0n);
    figures.push({
      ...base,
      period: `As of ${end}`,
      metric: "total_debt",
      label: "Total long-term debt",
      value: v.toString(),
      unit: "USD",
      basis: "calculated",
      formula: "Long-term debt (non-current) + current portion",
      text: `Total long-term debt was USD ${humanUsd(v)} as of ${end}.`,
    });
  } else missing.push("Debt");

  const prior =
    annual(facts, rev.c, null) &&
    points(facts, rev.c)
      .filter(
        (p) =>
          ANNUAL_FORMS.has(p.form) &&
          p.start &&
          days(p.start, p.end) > 330 &&
          days(p.start, p.end) < 400 &&
          Math.abs(days(p.end, end) - 365) < 20,
      )
      .sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (prior && big(prior) > 0n) {
    const g = percent(revenue - big(prior), big(prior));
    figures.push({
      ...base,
      currency: null,
      metric: "revenue_growth_yoy",
      label: "Revenue growth (YoY)",
      value: g,
      unit: "%",
      basis: "calculated",
      formula: `(Revenue ${fy} − Revenue prior year) ÷ Revenue prior year × 100`,
      text: `Revenue grew ${g}% year over year in ${period} (prior year USD ${humanUsd(big(prior))}).`,
    });
  } else missing.push("Prior-year revenue (growth)");

  return {
    figures,
    fiscalYear: fy,
    periodEnd: end,
    filed: rev.p.filed,
    accession: accn,
    missing,
    hasFacts: true,
  };
}

const METRIC_LABELS: Record<string, { label: string; unit: Figure["unit"] }> = {
  peTTM: { label: "P/E (TTM)", unit: "x" },
  psTTM: { label: "P/S (TTM)", unit: "x" },
  pbAnnual: { label: "P/B (annual)", unit: "x" },
  evEbitdaTTM: { label: "EV/EBITDA (TTM)", unit: "x" },
  marketCapitalization: { label: "Market capitalization", unit: "USD millions" },
  "52WeekHigh": { label: "52-week high", unit: "USD per share" },
  "52WeekLow": { label: "52-week low", unit: "USD per share" },
  beta: { label: "Beta", unit: "x" },
  dividendYieldIndicatedAnnual: { label: "Dividend yield (indicated)", unit: "%" },
};

export const FINNHUB_DOCS_URL = "https://finnhub.io/docs/api/company-basic-financials";

/** Valuation figures exactly as Finnhub publishes them (provider-calculated, labelled, not re-derived). */
export function valuationFigures(metrics: FinnhubMetrics, retrievedAt: Date): Figure[] {
  const asOf = retrievedAt.toISOString().slice(0, 10);
  const out: Figure[] = [];
  for (const [key, meta] of Object.entries(METRIC_LABELS)) {
    const raw = metrics[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const value = String(raw);
    if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) continue;
    out.push({
      metric: key,
      label: meta.label,
      value,
      unit: meta.unit,
      currency: meta.unit.startsWith("USD") ? "USD" : null,
      period: key.includes("TTM")
        ? "Trailing twelve months"
        : key.includes("52Week")
          ? "Last 52 weeks"
          : "Latest",
      asOf,
      basis: "calculated",
      formula: `As published by Finnhub (metric "${key}"); not recalculated by Suiem`,
      url: FINNHUB_DOCS_URL,
      accession: null,
      text: `${meta.label}: ${value}${meta.unit === "%" ? "%" : meta.unit === "x" ? "x" : ` ${meta.unit}`} (Finnhub, as of ${asOf}).`,
    });
  }
  return out;
}

export type DataFreshness = "fresh" | "stale" | "partial" | "unknown";

export function freshness(h: Highlights, now: Date, haveMarketData: boolean): DataFreshness {
  if (!h.hasFacts || h.figures.length === 0) return haveMarketData ? "partial" : "unknown";
  if (h.missing.length > 0 || !haveMarketData) return "partial";
  if (h.periodEnd && days(h.periodEnd, now.toISOString().slice(0, 10)) > 550) return "stale";
  return "fresh";
}
