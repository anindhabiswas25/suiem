// Records trimmed public responses from EDGAR and Finnhub into fixtures/ for offline tests.
// Run manually: pnpm --filter @suiem/research record-fixtures   (needs SEC_USER_AGENT, FINNHUB_API_KEY)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryCache } from "../providers/cache";
import { EdgarProvider } from "../providers/edgar";
import { FinnhubProvider } from "../providers/finnhub";

const out = join(import.meta.dirname, "..", "..", "fixtures");
const cache = new MemoryCache();
const edgar = new EdgarProvider(process.env.SEC_USER_AGENT, cache, 0);
const finnhub = new FinnhubProvider(process.env.FINNHUB_API_KEY, cache, 0);
const save = (name: string, data: unknown) =>
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`);

const to = "2026-11-10";
const from = "2026-10-11";
for (const [ticker, cik] of [
  ["NVDA", "0001045810"],
  ["AAPL", "0000320193"],
  ["TSM", "0001046179"],
] as const) {
  save(`edgar-facts-${cik}`, (await edgar.companyFacts(cik)).data);
  save(`edgar-filings-${cik}`, (await edgar.recentFilings(cik)).data);
  save(`finnhub-profile-${ticker}`, (await finnhub.profile(ticker)).data);
  save(`finnhub-quote-${ticker}`, (await finnhub.quote(ticker)).data);
  save(`finnhub-peers-${ticker}`, (await finnhub.peers(ticker)).data.slice(0, 8));
  save(`finnhub-metric-${ticker}`, (await finnhub.metrics(ticker)).data);
  save(`finnhub-news-${ticker}`, (await finnhub.news(ticker, from, to)).data);
  console.log(`recorded ${ticker}`);
}
