"use client";
import { robinhoodMainnet, robinhoodTestnet } from "@suiem/config/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

/** External EIP-1193 wallets only (MetaMask, Rabby, Robinhood Wallet, …). No smart accounts, no sponsorship. */
export const wagmiConfig = createConfig({
  chains: [robinhoodMainnet, robinhoodTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [robinhoodMainnet.id]: http(process.env.NEXT_PUBLIC_MAINNET_RPC_URL || undefined),
    [robinhoodTestnet.id]: http(process.env.NEXT_PUBLIC_TESTNET_RPC_URL || undefined),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
