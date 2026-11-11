import type { Figure, Highlights } from "./figures";
import { FINNHUB_DOCS_URL } from "./figures";
import type { EdgarFiling, FinnhubNews, FinnhubProfile, FinnhubQuote } from "./providers/types";
import { filingIndexUrl } from "./providers/edgar";

/** One numbered, citable source (PRD §7.2). `text` is the only content the model may use. */
export interface PackSource {
  id: string;
  kind: "financials" | "filings" | "profile" | "market" | "news";
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  retrievedAt: string;
  text: string;
}

export interface Retrieved {
  entity: { canonicalId: string; name: string; ticker: string | null; cik: string | null };
  highlights: Highlights | null;
  financialsRetrievedAt: Date | null;
  filings: { data: EdgarFiling[]; retrievedAt: Date; url: string } | null;
  profile: { data: FinnhubProfile; retrievedAt: Date } | null;
  quote: { data: FinnhubQuote; retrievedAt: Date } | null;
  peers: string[];
  valuation: Figure[];
  marketRetrievedAt: Date | null;
  news: { data: FinnhubNews[]; retrievedAt: Date } | null;
  missing: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Builds s1…sN in a fixed order: financials, filings, profile, market, news. */
export function buildSourcePack(r: Retrieved): {
  pack: PackSource[];
  ids: { financials?: string; market?: string };
} {
  const pack: PackSource[] = [];
  const ids: { financials?: string; market?: string } = {};
  const add = (s: Omit<PackSource, "id">) => {
    const id = `s${pack.length + 1}`;
    pack.push({ id, ...s });
    return id;
  };
  const h = r.highlights;
  if (h && h.figures.length > 0 && h.accession && r.entity.cik && r.financialsRetrievedAt) {
    ids.financials = add({
      kind: "financials",
      title: `${r.entity.name} annual report ${h.fiscalYear} (SEC filing ${h.accession}), financial data`,
      url: filingIndexUrl(r.entity.cik, h.accession),
      publisher: "SEC EDGAR",
      publishedAt: h.filed ? `${h.filed}T00:00:00.000Z` : null,
      retrievedAt: r.financialsRetrievedAt.toISOString(),
      text: [
        ...h.figures.map((f) => f.text),
        ...(h.missing.length ? [`Not available: ${h.missing.join("; ")}.`] : []),
      ].join("\n"),
    });
  }
  if (r.filings && r.filings.data.length > 0) {
    add({
      kind: "filings",
      title: `${r.entity.name} recent SEC filings`,
      url: r.filings.url,
      publisher: "SEC EDGAR",
      publishedAt: null,
      retrievedAt: r.filings.retrievedAt.toISOString(),
      text: r.filings.data
        .map(
          (f) =>
            `${f.form} filed ${f.filingDate}${f.reportDate ? ` for period ${f.reportDate}` : ""}`,
        )
        .join("\n"),
    });
  }
  if (r.profile && r.profile.data.name) {
    const p = r.profile.data;
    add({
      kind: "profile",
      title: `${p.name} company profile`,
      url:
        p.weburl && /^https?:\/\//.test(p.weburl)
          ? p.weburl
          : "https://finnhub.io/docs/api/company-profile2",
      publisher: "Finnhub (free tier)",
      publishedAt: null,
      retrievedAt: r.profile.retrievedAt.toISOString(),
      text: [
        `Name: ${p.name}`,
        p.finnhubIndustry ? `Industry: ${p.finnhubIndustry}` : null,
        p.country ? `Country: ${p.country}` : null,
        p.exchange ? `Exchange: ${p.exchange}` : null,
        p.ipo ? `IPO date: ${p.ipo}` : null,
        r.peers.length ? `Peers (as listed by Finnhub): ${r.peers.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  if (r.valuation.length > 0 || r.quote) {
    const lines = r.valuation.map((f) => f.text);
    if (r.quote && r.quote.data.t > 0)
      lines.unshift(
        `Last price: USD ${r.quote.data.c} at ${new Date(r.quote.data.t * 1000).toISOString()} (previous close USD ${r.quote.data.pc}).`,
      );
    ids.market = add({
      kind: "market",
      title: `${r.entity.ticker ?? r.entity.name} quote and valuation metrics`,
      url: FINNHUB_DOCS_URL,
      publisher: "Finnhub (free tier)",
      publishedAt: null,
      retrievedAt: (r.marketRetrievedAt ?? r.quote?.retrievedAt ?? new Date()).toISOString(),
      text: lines.join("\n"),
    });
  }
  for (const n of r.news?.data ?? []) {
    if (!/^https?:\/\//.test(n.url)) continue;
    add({
      kind: "news",
      title: clip(n.headline, 300),
      url: n.url,
      publisher: clip(n.source || "News", 120),
      publishedAt: new Date(n.datetime * 1000).toISOString(),
      retrievedAt: r.news!.retrievedAt.toISOString(),
      text: clip(`${n.headline}. ${n.summary}`, 450),
    });
  }
  return { pack, ids };
}

/** Neutralizes delimiter tricks inside untrusted text (e.g. a fake closing tag). */
export function sanitizeUntrusted(text: string): string {
  return text
    .replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›"))
    .split(String.fromCharCode(0))
    .join("");
}
