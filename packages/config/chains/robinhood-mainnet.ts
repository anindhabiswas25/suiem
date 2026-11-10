import { defineChain } from "viem";

/**
 * Robinhood Chain mainnet: used ONLY for $WIF elections and tips (ADR-0010 §1–2). Real value.
 * Every value cites its row in docs/VERIFIED_FACTS.md.
 */
export const robinhoodMainnet = defineChain({
  /** VERIFIED_FACTS C-03, M-01 (probed: eth_chainId 0x1237). */
  id: 4663,
  name: "Robinhood Chain",
  /** VERIFIED_FACTS C-12. */
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    /** VERIFIED_FACTS M-01. */
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  /** VERIFIED_FACTS C-11. */
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  /** VERIFIED_FACTS M-04. */
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const MAINNET_FACTS = {
  /** VERIFIED_FACTS M-02. */
  alchemyHttpBase: "https://robinhood-mainnet.g.alchemy.com/v2/",
  /** VERIFIED_FACTS M-03. */
  genesisHash: "0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c",
} as const;
