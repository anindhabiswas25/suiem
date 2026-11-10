/**
 * Robinhood Chain Testnet configuration: the ONLY chain Suiem targets (ADR-0001 §1, ADR-0002 §1).
 * Every value cites its row in docs/VERIFIED_FACTS.md. Do not add mainnet (4663) here.
 * Changing any value requires updating VERIFIED_FACTS.md in the same PR.
 */
export const ROBINHOOD_TESTNET = {
  /** VERIFIED_FACTS C-02, re-probed C-21 (eth_chainId = 0xb626). */
  id: 46630,
  /** VERIFIED_FACTS C-01. */
  name: "Robinhood Chain Testnet",
  /** VERIFIED_FACTS C-12: ETH is the gas token. */
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpc: {
    /** VERIFIED_FACTS C-07. Docs: "not recommended for production". Dev default and fallback. */
    publicHttp: "https://rpc.testnet.chain.robinhood.com",
    /** VERIFIED_FACTS C-08. The API key is appended at runtime from the secret provider. */
    alchemyHttpBase: "https://robinhood-testnet.g.alchemy.com/v2/",
  },
  /** VERIFIED_FACTS C-10 (Blockscout). */
  explorer: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  /** VERIFIED_FACTS T-01. Users are linked to the official faucet; Suiem never mints. */
  faucetUrl: "https://faucet.testnet.chain.robinhood.com",
  /** VERIFIED_FACTS C-21: used to detect a testnet reset. */
  genesisHash: "0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32",
  contracts: {
    /** VERIFIED_FACTS T-13 (code present on 46630). */
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    /** VERIFIED_FACTS A-08 (code present, identical to mainnet). Reference only; no AA in Phase 2. */
    entryPointV07: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  },
  /** VERIFIED_FACTS F-01..F-03. */
  finality: { soft: "sequencer", safe: "batch posted to Ethereum", final: "Ethereum finalized" },
  testnet: true,
} as const;

export type RobinhoodTestnet = typeof ROBINHOOD_TESTNET;
export const SUIEM_CHAIN_ID = ROBINHOOD_TESTNET.id;
