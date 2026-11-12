/**
 * Testnet registry facts (VERIFIED_FACTS T-05/T-06, verified 2026-11-11 by tracing faucet mints).
 * The official Robinhood Chain testnet faucet contract `0x8762F937…17Be` ("Faucet",
 * `sendTokensAndEther`) mints 5 of each of these five tokens to every claimant in one transaction.
 * Look-alikes with the same symbols exist and must never be registered.
 */
export const TESTNET_CHAIN_ID = 46630 as const;
export const TESTNET_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const TESTNET_FAUCET_CONTRACT = "0x8762F93772c663c6a88Ba50900bd5381df2717Be" as const;
export const FAUCET_TRACE_TX =
  "0x7701ca2b5602b96674eaf0243f346b0fc89ed398b9fe826d7c714d5538894732" as const;

export const DEMO_TICKERS = ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"] as const;
export type DemoTicker = (typeof DEMO_TICKERS)[number];

export const TESTNET_FAUCET_TOKENS: Record<
  DemoTicker,
  { address: `0x${string}`; name: string; decimals: 18; entity: string }
> = {
  TSLA: {
    address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
    name: "Tesla",
    decimals: 18,
    entity: "tesla",
  },
  AMZN: {
    address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
    name: "Amazon",
    decimals: 18,
    entity: "amazon",
  },
  PLTR: {
    address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
    name: "Palantir Technologies",
    decimals: 18,
    entity: "palantir",
  },
  NFLX: {
    address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
    name: "Netflix",
    decimals: 18,
    entity: "netflix",
  },
  AMD: {
    address: "0x71178BAc73cBeb415514eB542a8995b82669778d",
    name: "AMD",
    decimals: 18,
    entity: "amd",
  },
};

/** Labels shown on every row of the portfolio (never sum books together, PRD §8.4). */
export const BOOK_LABELS = {
  simulated: "Simulated",
  testnet: "Testnet · no value",
  faucet: "Testnet test token · no value",
} as const;

export const explorerTx = (hash: string) => `${TESTNET_EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: string) => `${TESTNET_EXPLORER}/address/${address}`;
