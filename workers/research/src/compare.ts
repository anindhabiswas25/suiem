import type { Figure } from "./figures";
import { type PipelineDeps, type ResolvedEntity, retrieve } from "./pipeline";
import { filingIndexUrl } from "./providers/edgar";

export interface CompareCell {
  value: string | null;
  unit: string | null;
  currency: string | null;
  period: string | null;
  asOf: string | null;
  basis: string | null;
  formula: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
}
export interface CompareResult {
  entities: { canonicalId: string; name: string; ticker: string | null; dataNotes: string[] }[];
  rows: { metric: string; label: string; cells: CompareCell[] }[];
  generatedAt: string;
}

const METRICS: [string, string][] = [
  ["revenue", "Revenue"],
  ["revenue_growth_yoy", "Revenue growth (YoY)"],
  ["gross_margin", "Gross margin"],
  ["operating_income", "Operating income"],
  ["net_income", "Net income"],
  ["operating_cash_flow", "Operating cash flow"],
  ["cash", "Cash and cash equivalents"],
  ["total_debt", "Total long-term debt"],
  ["marketCapitalization", "Market capitalization"],
  ["peTTM", "P/E (TTM)"],
  ["psTTM", "P/S (TTM)"],
  ["evEbitdaTTM", "EV/EBITDA (TTM)"],
];

const empty: CompareCell = {
  value: null,
  unit: null,
  currency: null,
  period: null,
  asOf: null,
  basis: null,
  formula: null,
  sourceUrl: null,
  sourceLabel: null,
};

/** Deterministic comparison table from EDGAR + Finnhub figures. No LLM. Missing data stays null. */
export async function compareEntities(
  deps: Pick<PipelineDeps, "filings" | "market" | "now">,
  entities: ResolvedEntity[],
): Promise<CompareResult> {
  const data: { e: ResolvedEntity; r: Awaited<ReturnType<typeof retrieve>> }[] = [];
  for (const e of entities) data.push({ e, r: await retrieve(deps, e, { news: false }) });
  const cell = (f: Figure | undefined, cik: string | null): CompareCell =>
    f
      ? {
          value: f.value,
          unit: f.unit,
          currency: f.currency,
          period: f.period,
          asOf: f.asOf,
          basis: f.basis,
          formula: f.formula,
          sourceUrl: f.accession && cik ? filingIndexUrl(cik, f.accession) : f.url,
          sourceLabel: f.accession ? `SEC EDGAR ${f.accession}` : "Finnhub (free tier)",
        }
      : empty;
  return {
    entities: data.map(({ e, r }) => ({
      canonicalId: e.canonicalId,
      name: e.name,
      ticker: e.ticker,
      dataNotes: r.missing,
    })),
    rows: METRICS.map(([metric, label]) => ({
      metric,
      label,
      cells: data.map(({ e, r }) =>
        cell(
          [...(r.highlights?.figures ?? []), ...r.valuation].find((f) => f.metric === metric),
          e.cik,
        ),
      ),
    })),
    generatedAt: deps.now().toISOString(),
  };
}
