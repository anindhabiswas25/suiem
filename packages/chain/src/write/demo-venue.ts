/**
 * The ONLY place that builds SuiemDemoVenue calldata and signs quotes (testnet 46630 only).
 * Research and the extension can never import this (depcruise `research-no-chain-*`, `extension-no-chain`).
 */
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { demoUSDAbi, suiemDemoVenueAbi } from "../abi/demo";

export const DEMO_CHAIN_ID = 46630 as const;

export class WrongChainError extends Error {
  constructor(chainId: number) {
    super(`Testnet-only key used for chain ${chainId}; only 46630 is allowed`);
    this.name = "WrongChainError";
  }
}
export const assertTestnet = (chainId: number) => {
  if (chainId !== DEMO_CHAIN_ID) throw new WrongChainError(chainId);
};

export type Side = 0 | 1; // Buy | Sell (matches the Solidity enum)
export interface Quote {
  trader: Address;
  token: Address;
  side: Side;
  amountIn: bigint;
  price: bigint;
  feeBps: number;
  expiry: bigint;
  nonce: bigint;
}

export const QUOTE_TYPES = {
  Quote: [
    { name: "trader", type: "address" },
    { name: "token", type: "address" },
    { name: "side", type: "uint8" },
    { name: "amountIn", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "feeBps", type: "uint16" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const quoteDomain = (chainId: number, venue: Address) =>
  ({ name: "SuiemDemoVenue", version: "1", chainId, verifyingContract: venue }) as const;

/** Signs a quote with the testnet-only quote signer. Refuses any chain other than 46630. */
export async function signQuote(
  privateKey: Hex,
  chainId: number,
  venue: Address,
  q: Quote,
): Promise<Hex> {
  assertTestnet(chainId);
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData({
    domain: quoteDomain(chainId, venue),
    types: QUOTE_TYPES,
    primaryType: "Quote",
    message: q,
  });
}

export const quoteSignerAddress = (privateKey: Hex): Address =>
  privateKeyToAccount(privateKey).address;

/** Mirrors SuiemDemoVenue.previewOut exactly (bigint; rounding toward the venue). */
export function previewOut(
  side: Side,
  amountIn: bigint,
  price: bigint,
  feeBps: number,
): { out: bigint; fee: bigint } {
  const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);
  const bps = BigInt(feeBps);
  if (side === 0) {
    const fee = ceilDiv(amountIn * bps, 10_000n);
    return { out: ((amountIn - fee) * 10n ** 18n) / price, fee };
  }
  const gross = (amountIn * price) / 10n ** 18n;
  const fee = ceilDiv(gross * bps, 10_000n);
  return { out: gross - fee, fee };
}

export function encodeTrade(q: Quote, signature: Hex, minOut: bigint): Hex {
  const quote = { ...q, expiry: q.expiry };
  return encodeFunctionData({
    abi: suiemDemoVenueAbi,
    functionName: q.side === 0 ? "buy" : "sell",
    args: [quote, signature, minOut],
  });
}

export function decodeTrade(data: Hex) {
  const d = decodeFunctionData({ abi: suiemDemoVenueAbi, data });
  if (d.functionName !== "buy" && d.functionName !== "sell")
    throw new Error(`not a trade call: ${d.functionName}`);
  const [quote, signature, minOut] = d.args as unknown as [Quote, Hex, bigint];
  return { functionName: d.functionName, quote, signature, minOut };
}

/** Exact-amount approval (never unlimited). */
export const encodeApprove = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi: demoUSDAbi, functionName: "approve", args: [spender, amount] });
export const encodeClaim = (): Hex =>
  encodeFunctionData({ abi: demoUSDAbi, functionName: "claim", args: [] });

/** Binds a preview to exactly what the wallet will send: keccak256(chainId, to, data, value). */
export function previewHash(chainId: number, to: Address, data: Hex, value: bigint = 0n): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, address, bytes, uint256"), [
      BigInt(chainId),
      to,
      data,
      value,
    ]),
  );
}
