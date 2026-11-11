import { cached, type SourceCache } from "./cache";
import { createHttp, type Fetcher, ProviderError } from "./http";
import type { EdgarCompanyFacts, EdgarFiling, FilingsProvider } from "./types";

/** Concepts used for highlights (others are dropped to keep cached payloads small). */
export const EDGAR_CONCEPTS = [
  "Revenues",
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "SalesRevenueNet",
  "CostOfRevenue",
  "CostOfGoodsAndServicesSold",
  "GrossProfit",
  "OperatingIncomeLoss",
  "NetIncomeLoss",
  "NetCashProvidedByUsedInOperatingActivities",
  "CashAndCashEquivalentsAtCarryingValue",
  "LongTermDebt",
  "LongTermDebtNoncurrent",
  "LongTermDebtCurrent",
  "DebtCurrent",
] as const;

const KEEP_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "10-K/A", "10-Q/A"]);

/** Trims companyfacts to the concepts we use and recent periods (public data, cache-friendly). */
export function trimFacts(raw: EdgarCompanyFacts): EdgarCompanyFacts {
  const gaap = raw.facts["us-gaap"] ?? {};
  const kept: EdgarCompanyFacts["facts"] = { "us-gaap": {} };
  for (const c of EDGAR_CONCEPTS) {
    const usd = gaap[c]?.units.USD;
    if (!usd) continue;
    const points = usd.filter((p) => KEEP_FORMS.has(p.form) && p.end >= "2021-01-01");
    if (points.length) kept["us-gaap"]![c] = { units: { USD: points } };
  }
  return { cik: raw.cik, entityName: raw.entityName, facts: kept };
}

export function filingIndexUrl(cik: string, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}/${accn}-index.htm`;
}

export class EdgarProvider implements FilingsProvider {
  private readonly get;
  constructor(
    userAgent: string | undefined,
    private readonly cache: SourceCache,
    private readonly ttlMs: number,
    opts: { fetcher?: Fetcher; minIntervalMs?: number } = {},
  ) {
    // SEC fair-access policy: every request must identify the caller. Refuse to run without it.
    if (!userAgent)
      throw new ProviderError("edgar", 0, "SEC_USER_AGENT is required to call SEC EDGAR");
    // ≤ 10 req/s allowed; we throttle to ~5.
    this.get = createHttp({
      provider: "edgar",
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      minIntervalMs: opts.minIntervalMs ?? 200,
      fetcher: opts.fetcher,
    });
  }

  async companyFacts(cik: string) {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const r = await cached(this.cache, "edgar", `facts:${cik}`, this.ttlMs, async () => {
      try {
        return trimFacts(await this.get<EdgarCompanyFacts>(url));
      } catch (e) {
        // Foreign filers without XBRL company facts return 404: report as missing, never invent.
        if (e instanceof ProviderError && e.status === 404) return null;
        throw e;
      }
    });
    return { data: r.data, retrievedAt: r.retrievedAt, url };
  }

  async recentFilings(cik: string) {
    const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const r = await cached(this.cache, "edgar", `filings:${cik}`, this.ttlMs, async () => {
      const raw = await this.get<{ filings: { recent: Record<string, string[]> } }>(url);
      const rec = raw.filings.recent;
      const out: EdgarFiling[] = [];
      for (let i = 0; i < (rec.form?.length ?? 0) && out.length < 12; i++) {
        if (!KEEP_FORMS.has(rec.form![i]!) && !["8-K", "6-K"].includes(rec.form![i]!)) continue;
        out.push({
          accessionNumber: rec.accessionNumber![i]!,
          form: rec.form![i]!,
          filingDate: rec.filingDate![i]!,
          reportDate: rec.reportDate![i] ?? "",
          primaryDocument: rec.primaryDocument![i] ?? "",
        });
      }
      return out;
    });
    return {
      data: r.data,
      retrievedAt: r.retrievedAt,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
    };
  }
}
