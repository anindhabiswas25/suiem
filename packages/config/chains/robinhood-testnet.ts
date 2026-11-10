import { defineChain } from "viem";

/**
 * Robinhood Chain Testnet: Stock Token demo flow only (ADR-0010 §1). No value.
 * Every value cites its row in docs/VERIFIED_FACTS.md.
 */
export const robinhoodTestnet = defineChain({
  /** VERIFIED_FACTS C-02 (probed: eth_chainId 0xb626). */
  id: 46630,
  /** VERIFIED_FACTS C-01. */
  name: "Robinhood Chain Testnet",
  /** VERIFIED_FACTS C-12. */
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    /** VERIFIED_FACTS C-07 ("not recommended for production"). */
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  /** VERIFIED_FACTS C-10. */
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  /** VERIFIED_FACTS T-13. */
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const TESTNET_FACTS = {
  /** VERIFIED_FACTS C-08: append the API key at runtime. */
  alchemyHttpBase: "https://robinhood-testnet.g.alchemy.com/v2/",
  /** VERIFIED_FACTS T-01: users are linked to the official faucet; Suiem never mints. */
  faucetUrl: "https://faucet.testnet.chain.robinhood.com",
  /** VERIFIED_FACTS C-21: testnet-reset detection. */
  genesisHash: "0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32",
} as const;
