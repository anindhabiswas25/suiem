/** Raw shapes returned by providers (subset we use). */
export interface EdgarFactPoint {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number | null;
  fp: string | null;
  form: string;
  filed: string;
  frame?: string;
}
export interface EdgarCompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<
    string,
    Record<string, { label?: string; units: Record<string, EdgarFactPoint[]> }>
  >;
}
export interface EdgarFiling {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
}

export interface FinnhubProfile {
  name?: string;
  ticker?: string;
  exchange?: string;
  finnhubIndustry?: string;
  country?: string;
  currency?: string;
  marketCapitalization?: number;
  weburl?: string;
  ipo?: string;
}
export interface FinnhubQuote {
  c: number;
  d: number | null;
  dp: number | null;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}
export interface FinnhubNews {
  id: number;
  datetime: number;
  headline: string;
  source: string;
  summary: string;
  url: string;
}
export type FinnhubMetrics = Record<string, number | string | null>;

/** Financial-data interfaces (PRD §13.3 "provider adapters"). Implementations: EDGAR, Finnhub. */
export interface FilingsProvider {
  companyFacts(
    cik: string,
  ): Promise<{ data: EdgarCompanyFacts | null; retrievedAt: Date; url: string }>;
  recentFilings(cik: string): Promise<{ data: EdgarFiling[]; retrievedAt: Date; url: string }>;
}
export interface MarketDataProvider {
  profile(ticker: string): Promise<{ data: FinnhubProfile; retrievedAt: Date }>;
  quote(ticker: string): Promise<{ data: FinnhubQuote; retrievedAt: Date }>;
  peers(ticker: string): Promise<{ data: string[]; retrievedAt: Date }>;
  metrics(ticker: string): Promise<{ data: FinnhubMetrics; retrievedAt: Date }>;
  news(
    ticker: string,
    from: string,
    to: string,
  ): Promise<{ data: FinnhubNews[]; retrievedAt: Date }>;
}
