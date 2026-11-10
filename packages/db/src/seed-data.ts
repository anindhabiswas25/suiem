/**
 * Demo seed data. Entities are public reference facts (names, tickers), not market data.
 * Ambiguous aliases (ordinary words, single letters) are flagged so detection stays silent (PRD §6.3).
 */
export interface SeedEntity {
  slug: string;
  name: string;
  legalName: string;
  kind: "company" | "fund" | "index";
  sector: string;
  country: string;
  aliases: {
    alias: string;
    type: "name" | "legal_name" | "ticker" | "cashtag" | "product";
    ambiguous?: boolean;
  }[];
}

const co = (
  slug: string,
  name: string,
  legalName: string,
  ticker: string,
  sector: string,
  country: string,
  extra: SeedEntity["aliases"] = [],
  nameAmbiguous = false,
): SeedEntity => ({
  slug,
  name,
  legalName,
  kind: "company",
  sector,
  country,
  aliases: [
    { alias: name, type: "name", ambiguous: nameAmbiguous },
    { alias: legalName, type: "legal_name" },
    { alias: ticker, type: "ticker", ambiguous: ticker.length <= 2 },
    { alias: `$${ticker}`, type: "cashtag" },
    ...extra,
  ],
});

export const SEED_ENTITIES: SeedEntity[] = [
  co("nvidia", "NVIDIA", "NVIDIA Corporation", "NVDA", "Semiconductors", "US"),
  co("apple", "Apple", "Apple Inc.", "AAPL", "Technology Hardware", "US", [], true),
  co("microsoft", "Microsoft", "Microsoft Corporation", "MSFT", "Software", "US"),
  co(
    "alphabet",
    "Alphabet",
    "Alphabet Inc.",
    "GOOGL",
    "Internet",
    "US",
    [
      { alias: "Google", type: "name" },
      { alias: "GOOG", type: "ticker" },
    ],
    true,
  ),
  co("amazon", "Amazon", "Amazon.com, Inc.", "AMZN", "Internet Retail", "US", [], true),
  co("meta", "Meta Platforms", "Meta Platforms, Inc.", "META", "Internet", "US", [
    { alias: "Meta", type: "name", ambiguous: true },
  ]),
  co("tesla", "Tesla", "Tesla, Inc.", "TSLA", "Automobiles", "US"),
  co("palantir", "Palantir", "Palantir Technologies Inc.", "PLTR", "Software", "US"),
  co("netflix", "Netflix", "Netflix, Inc.", "NFLX", "Media", "US"),
  co("amd", "AMD", "Advanced Micro Devices, Inc.", "AMD", "Semiconductors", "US", [
    { alias: "Advanced Micro Devices", type: "name" },
  ]),
  co("intel", "Intel", "Intel Corporation", "INTC", "Semiconductors", "US"),
  co("oracle", "Oracle", "Oracle Corporation", "ORCL", "Software", "US", [], true),
  co("salesforce", "Salesforce", "Salesforce, Inc.", "CRM", "Software", "US"),
  co("adobe", "Adobe", "Adobe Inc.", "ADBE", "Software", "US"),
  co("broadcom", "Broadcom", "Broadcom Inc.", "AVGO", "Semiconductors", "US"),
  co(
    "tsmc",
    "TSMC",
    "Taiwan Semiconductor Manufacturing Company Limited",
    "TSM",
    "Semiconductors",
    "TW",
  ),
  co("asml", "ASML", "ASML Holding N.V.", "ASML", "Semiconductor Equipment", "NL"),
  co("coinbase", "Coinbase", "Coinbase Global, Inc.", "COIN", "Financial Services", "US"),
  co("shopify", "Shopify", "Shopify Inc.", "SHOP", "Software", "CA"),
  co("uber", "Uber", "Uber Technologies, Inc.", "UBER", "Transportation", "US"),
  co("airbnb", "Airbnb", "Airbnb, Inc.", "ABNB", "Travel", "US"),
  co("disney", "Disney", "The Walt Disney Company", "DIS", "Media", "US"),
  co("walmart", "Walmart", "Walmart Inc.", "WMT", "Retail", "US"),
  co("jpmorgan", "JPMorgan Chase", "JPMorgan Chase & Co.", "JPM", "Banks", "US"),
  co("visa", "Visa", "Visa Inc.", "V", "Financial Services", "US", [], true),
  co("mastercard", "Mastercard", "Mastercard Incorporated", "MA", "Financial Services", "US"),
  co("berkshire", "Berkshire Hathaway", "Berkshire Hathaway Inc.", "BRK.B", "Diversified", "US"),
  co("eli-lilly", "Eli Lilly", "Eli Lilly and Company", "LLY", "Pharmaceuticals", "US"),
  co("novo-nordisk", "Novo Nordisk", "Novo Nordisk A/S", "NVO", "Pharmaceuticals", "DK"),
  {
    slug: "sp500",
    name: "S&P 500",
    legalName: "S&P 500 Index",
    kind: "index",
    sector: "Index",
    country: "US",
    aliases: [
      { alias: "S&P 500", type: "name" },
      { alias: "SPX", type: "ticker" },
      { alias: "$SPX", type: "cashtag" },
    ],
  },
];

/**
 * The 5 test Stock Tokens the official faucet hands out (VERIFIED_FACTS T-02). Their contract
 * addresses are UNVERIFIED (T-05), so they stay `unverified` with no address until Sprint 5.
 */
export const TESTNET_STOCK_TOKENS = [
  { entity: "tesla", symbol: "TEST:TSLA", name: "Tesla test token" },
  { entity: "amazon", symbol: "TEST:AMZN", name: "Amazon test token" },
  { entity: "palantir", symbol: "TEST:PLTR", name: "Palantir test token" },
  { entity: "netflix", symbol: "TEST:NFLX", name: "Netflix test token" },
  { entity: "amd", symbol: "TEST:AMD", name: "AMD test token" },
] as const;

export const DEMO_USERS = [
  {
    handle: "demo_ada",
    displayName: "Ada (demo)",
    interests: ["technology", "ai"],
    jurisdiction: "IN",
  },
  {
    handle: "demo_grace",
    displayName: "Grace (demo)",
    interests: ["healthcare", "finance"],
    jurisdiction: "DE",
  },
  {
    handle: "demo_alan",
    displayName: "Alan (demo)",
    interests: ["energy", "consumer"],
    jurisdiction: "SG",
  },
] as const;
