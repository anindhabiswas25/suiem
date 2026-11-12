import { robinhoodMainnet } from "./robinhood-mainnet";

/**
 * $WIF exists only on mainnet 4663. Source: organiser API (VERIFIED_FACTS W-11…W-14).
 * There is deliberately no testnet $WIF constant: any $WIF lookup on another chain is a bug.
 * Burn semantics verified onchain (W-16): `burn` and `burnFrom` exist and lower
 * `totalSupply`; no fee on transfer, no pause, no blocklist, not a proxy.
 * Lookalike defence: this constant is the ONLY $WIF address; nothing accepts one from user input.
 */
export const WIF = {
  /** VERIFIED_FACTS W-11. */
  chainId: robinhoodMainnet.id,
  /** VERIFIED_FACTS W-12 (checksummed). */
  address: "0x5173b8eA6923c2d40267890D45C46a3480954773",
  /** VERIFIED_FACTS W-13. */
  decimals: 18,
  /** VERIFIED_FACTS W-16 (onchain `symbol()`). */
  symbol: "WIF",
  /** VERIFIED_FACTS W-16 (onchain `name()`). */
  name: "World is Flat",
} as const;

/** The hackathon organiser's own vote contract (VERIFIED_FACTS W-14). Reference only. */
export const ORGANISER_VOTE_CONTRACT = {
  chainId: robinhoodMainnet.id,
  address: "0xd1b711917a405782da2ec650a0ee4711a76a5535",
  voteSignature: "vote(uint256,uint256,uint256)",
  eventSignature: "Voted(address,uint256,uint256)",
} as const;

export function wifForChain(chainId: number): typeof WIF {
  if (chainId !== WIF.chainId)
    throw new Error(`$WIF exists only on chain ${WIF.chainId}; refusing chain ${chainId}`);
  return WIF;
}
