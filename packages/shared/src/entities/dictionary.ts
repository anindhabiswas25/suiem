/**
 * Entity dictionary: the single source used by the DB seed and the extension's local detector.
 * Public reference facts only (names, tickers), with no market data and no network I/O.
 * `ambiguous` marks aliases that are ordinary words or ticker collisions (PRD §6.3): those need
 * supporting financial context before they may produce a notification.
 */
export type EntityKind = "company" | "product" | "fund" | "index" | "crypto";
export type AliasType =
  "name" | "legal_name" | "ticker" | "cashtag" | "exchange_symbol" | "product";

export interface EntityAlias {
  alias: string;
  type: AliasType;
  ambiguous: boolean;
}

export interface DictionaryEntity {
  /** `ent:<slug>` */
  canonicalId: string;
  slug: string;
  name: string;
  legalName: string;
  kind: EntityKind;
  sector: string;
  country: string;
  tickers: string[];
  aliases: EntityAlias[];
}

export const DICTIONARY_VERSION = "2026-11-11.1";

/** Tickers that are also ordinary words or common abbreviations. */
const AMBIGUOUS_TICKERS = new Set([
  "ON",
  "ALL",
  "IT",
  "ARM",
  "MA",
  "V",
  "U",
  "A",
  "T",
  "F",
  "AI",
  "NOW",
  "SO",
  "KEY",
  "CAT",
]);

interface Spec {
  slug: string;
  name: string;
  legalName: string;
  kind?: EntityKind;
  sector: string;
  country?: string;
  tickers: string[];
  exchange?: string;
  /** Extra names (brands, short names). */
  names?: string[];
  /** Names/aliases that are ordinary words. */
  ambiguousNames?: string[];
  /** If true, the primary name itself is an ordinary word. */
  nameAmbiguous?: boolean;
}

function build(s: Spec): DictionaryEntity {
  const aliases: EntityAlias[] = [];
  const push = (alias: string, type: AliasType, ambiguous: boolean) => {
    if (!aliases.some((a) => a.alias === alias && a.type === type))
      aliases.push({ alias, type, ambiguous });
  };
  push(s.name, "name", s.nameAmbiguous ?? false);
  push(s.legalName, "legal_name", false);
  for (const n of s.names ?? []) push(n, "name", false);
  for (const n of s.ambiguousNames ?? []) push(n, "name", true);
  for (const t of s.tickers) {
    const amb = AMBIGUOUS_TICKERS.has(t);
    push(t, "ticker", amb);
    push(`$${t}`, "cashtag", amb);
    if (s.exchange) push(`${s.exchange}:${t}`, "exchange_symbol", false);
  }
  return {
    canonicalId: `ent:${s.slug}`,
    slug: s.slug,
    name: s.name,
    legalName: s.legalName,
    kind: s.kind ?? "company",
    sector: s.sector,
    country: s.country ?? "US",
    tickers: s.tickers,
    aliases,
  };
}

const SPECS: Spec[] = [
  {
    slug: "nvidia",
    name: "NVIDIA",
    legalName: "NVIDIA Corporation",
    sector: "Semiconductors",
    tickers: ["NVDA"],
    exchange: "NASDAQ",
    names: ["Nvidia"],
  },
  {
    slug: "apple",
    name: "Apple",
    legalName: "Apple Inc.",
    sector: "Technology Hardware",
    tickers: ["AAPL"],
    exchange: "NASDAQ",
    nameAmbiguous: true,
  },
  {
    slug: "microsoft",
    name: "Microsoft",
    legalName: "Microsoft Corporation",
    sector: "Software",
    tickers: ["MSFT"],
    exchange: "NASDAQ",
  },
  {
    slug: "alphabet",
    name: "Alphabet",
    legalName: "Alphabet Inc.",
    sector: "Internet",
    tickers: ["GOOGL", "GOOG"],
    exchange: "NASDAQ",
    names: ["Google"],
    nameAmbiguous: true,
  },
  {
    slug: "amazon",
    name: "Amazon",
    legalName: "Amazon.com, Inc.",
    sector: "Internet Retail",
    tickers: ["AMZN"],
    exchange: "NASDAQ",
    names: ["Amazon.com"],
    nameAmbiguous: true,
  },
  {
    slug: "meta",
    name: "Meta Platforms",
    legalName: "Meta Platforms, Inc.",
    sector: "Internet",
    tickers: ["META"],
    exchange: "NASDAQ",
    ambiguousNames: ["Meta"],
  },
  {
    slug: "tesla",
    name: "Tesla",
    legalName: "Tesla, Inc.",
    sector: "Automobiles",
    tickers: ["TSLA"],
    exchange: "NASDAQ",
  },
  {
    slug: "palantir",
    name: "Palantir",
    legalName: "Palantir Technologies Inc.",
    sector: "Software",
    tickers: ["PLTR"],
    exchange: "NASDAQ",
  },
  {
    slug: "netflix",
    name: "Netflix",
    legalName: "Netflix, Inc.",
    sector: "Media",
    tickers: ["NFLX"],
    exchange: "NASDAQ",
  },
  {
    slug: "amd",
    name: "AMD",
    legalName: "Advanced Micro Devices, Inc.",
    sector: "Semiconductors",
    tickers: ["AMD"],
    exchange: "NASDAQ",
    names: ["Advanced Micro Devices"],
  },
  {
    slug: "intel",
    name: "Intel",
    legalName: "Intel Corporation",
    sector: "Semiconductors",
    tickers: ["INTC"],
    exchange: "NASDAQ",
    nameAmbiguous: true,
  },
  {
    slug: "oracle",
    name: "Oracle",
    legalName: "Oracle Corporation",
    sector: "Software",
    tickers: ["ORCL"],
    exchange: "NYSE",
    nameAmbiguous: true,
  },
  {
    slug: "salesforce",
    name: "Salesforce",
    legalName: "Salesforce, Inc.",
    sector: "Software",
    tickers: ["CRM"],
    exchange: "NYSE",
  },
  {
    slug: "adobe",
    name: "Adobe",
    legalName: "Adobe Inc.",
    sector: "Software",
    tickers: ["ADBE"],
    exchange: "NASDAQ",
  },
  {
    slug: "broadcom",
    name: "Broadcom",
    legalName: "Broadcom Inc.",
    sector: "Semiconductors",
    tickers: ["AVGO"],
    exchange: "NASDAQ",
  },
  {
    slug: "tsmc",
    name: "TSMC",
    legalName: "Taiwan Semiconductor Manufacturing Company Limited",
    sector: "Semiconductors",
    country: "TW",
    tickers: ["TSM"],
    exchange: "NYSE",
    names: ["Taiwan Semiconductor"],
  },
  {
    slug: "asml",
    name: "ASML",
    legalName: "ASML Holding N.V.",
    sector: "Semiconductor Equipment",
    country: "NL",
    tickers: ["ASML"],
    exchange: "NASDAQ",
  },
  {
    slug: "coinbase",
    name: "Coinbase",
    legalName: "Coinbase Global, Inc.",
    sector: "Financial Services",
    tickers: ["COIN"],
    exchange: "NASDAQ",
  },
  {
    slug: "shopify",
    name: "Shopify",
    legalName: "Shopify Inc.",
    sector: "Software",
    country: "CA",
    tickers: ["SHOP"],
    exchange: "NYSE",
  },
  {
    slug: "uber",
    name: "Uber",
    legalName: "Uber Technologies, Inc.",
    sector: "Transportation",
    tickers: ["UBER"],
    exchange: "NYSE",
  },
  {
    slug: "airbnb",
    name: "Airbnb",
    legalName: "Airbnb, Inc.",
    sector: "Travel",
    tickers: ["ABNB"],
    exchange: "NASDAQ",
  },
  {
    slug: "disney",
    name: "Disney",
    legalName: "The Walt Disney Company",
    sector: "Media",
    tickers: ["DIS"],
    exchange: "NYSE",
    names: ["Walt Disney"],
  },
  {
    slug: "walmart",
    name: "Walmart",
    legalName: "Walmart Inc.",
    sector: "Retail",
    tickers: ["WMT"],
    exchange: "NYSE",
  },
  {
    slug: "jpmorgan",
    name: "JPMorgan Chase",
    legalName: "JPMorgan Chase & Co.",
    sector: "Banks",
    tickers: ["JPM"],
    exchange: "NYSE",
    names: ["JPMorgan", "JP Morgan"],
  },
  {
    slug: "visa",
    name: "Visa",
    legalName: "Visa Inc.",
    sector: "Financial Services",
    tickers: ["V"],
    exchange: "NYSE",
    nameAmbiguous: true,
  },
  {
    slug: "mastercard",
    name: "Mastercard",
    legalName: "Mastercard Incorporated",
    sector: "Financial Services",
    tickers: ["MA"],
    exchange: "NYSE",
  },
  {
    slug: "berkshire",
    name: "Berkshire Hathaway",
    legalName: "Berkshire Hathaway Inc.",
    sector: "Diversified",
    tickers: ["BRK.B"],
    exchange: "NYSE",
  },
  {
    slug: "eli-lilly",
    name: "Eli Lilly",
    legalName: "Eli Lilly and Company",
    sector: "Pharmaceuticals",
    tickers: ["LLY"],
    exchange: "NYSE",
  },
  {
    slug: "novo-nordisk",
    name: "Novo Nordisk",
    legalName: "Novo Nordisk A/S",
    sector: "Pharmaceuticals",
    country: "DK",
    tickers: ["NVO"],
    exchange: "NYSE",
  },
  {
    slug: "qualcomm",
    name: "Qualcomm",
    legalName: "QUALCOMM Incorporated",
    sector: "Semiconductors",
    tickers: ["QCOM"],
    exchange: "NASDAQ",
  },
  {
    slug: "micron",
    name: "Micron",
    legalName: "Micron Technology, Inc.",
    sector: "Semiconductors",
    tickers: ["MU"],
    exchange: "NASDAQ",
    names: ["Micron Technology"],
  },
  {
    slug: "arm",
    name: "Arm Holdings",
    legalName: "Arm Holdings plc",
    sector: "Semiconductors",
    country: "GB",
    tickers: ["ARM"],
    exchange: "NASDAQ",
    ambiguousNames: ["Arm"],
  },
  {
    slug: "onsemi",
    name: "onsemi",
    legalName: "ON Semiconductor Corporation",
    sector: "Semiconductors",
    tickers: ["ON"],
    exchange: "NASDAQ",
    names: ["ON Semiconductor"],
  },
  {
    slug: "allstate",
    name: "Allstate",
    legalName: "The Allstate Corporation",
    sector: "Insurance",
    tickers: ["ALL"],
    exchange: "NYSE",
  },
  {
    slug: "gartner",
    name: "Gartner",
    legalName: "Gartner, Inc.",
    sector: "IT Services",
    tickers: ["IT"],
    exchange: "NYSE",
  },
  {
    slug: "bitcoin",
    name: "Bitcoin",
    legalName: "Bitcoin",
    kind: "crypto",
    sector: "Crypto asset",
    country: "ZZ",
    tickers: ["BTC"],
  },
  {
    slug: "ethereum",
    name: "Ethereum",
    legalName: "Ethereum",
    kind: "crypto",
    sector: "Crypto asset",
    country: "ZZ",
    tickers: ["ETH"],
    names: ["Ether"],
  },
  {
    slug: "sp500",
    name: "S&P 500",
    legalName: "S&P 500 Index",
    kind: "index",
    sector: "Index",
    tickers: ["SPX"],
    names: ["S&P500"],
  },
  {
    slug: "spy-etf",
    name: "SPDR S&P 500 ETF",
    legalName: "SPDR S&P 500 ETF Trust",
    kind: "fund",
    sector: "ETF",
    tickers: ["SPY"],
    exchange: "NYSEARCA",
  },
  {
    slug: "qqq-etf",
    name: "Invesco QQQ",
    legalName: "Invesco QQQ Trust",
    kind: "fund",
    sector: "ETF",
    tickers: ["QQQ"],
    exchange: "NASDAQ",
  },
];

export const ENTITY_DICTIONARY: readonly DictionaryEntity[] = SPECS.map(build);

/** The 5 test Stock Tokens handed out by the official faucet (VERIFIED_FACTS T-02). */
export const TESTNET_STOCK_TOKEN_ENTITIES = [
  "tesla",
  "amazon",
  "palantir",
  "netflix",
  "amd",
] as const;

export function entityById(canonicalId: string): DictionaryEntity | undefined {
  return ENTITY_DICTIONARY.find((e) => e.canonicalId === canonicalId);
}
