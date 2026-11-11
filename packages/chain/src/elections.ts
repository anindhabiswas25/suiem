/**
 * Read-side helpers for SuiemElections on Robinhood Chain mainnet 4663 ($WIF burn-to-vote).
 * Writes (calldata builders) live in ./write/elections.ts only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { robinhoodMainnet, WIF } from "@suiem/config/chains";
import { erc20Abi, getAddress, type PublicClient } from "viem";
import { z } from "zod";
import { suiemElectionsAbi } from "./abi/elections";

export { suiemElectionsAbi };
export const ELECTIONS_CHAIN_ID = robinhoodMainnet.id;
export const TOKEN_PER_VOTE = 10n ** 18n;
export const MAINNET_EXPLORER = robinhoodMainnet.blockExplorers.default.url;
export const explorerTx = (hash: string) => `${MAINNET_EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: string) => `${MAINNET_EXPLORER}/address/${address}`;

export class WifIdentityError extends Error {
  override readonly name = "WifIdentityError";
}

/**
 * Lookalike defence at startup: the RPC must be chain 4663 and the hard-coded $WIF address must
 * report 18 decimals and the expected symbol and name. Throws otherwise.
 */
export async function assertWifIdentity(
  client: Pick<PublicClient, "getChainId" | "readContract">,
): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId !== WIF.chainId)
    throw new WifIdentityError(`chainId ${chainId}, expected ${WIF.chainId}`);
  const [decimals, symbol, name] = await Promise.all([
    client.readContract({ address: WIF.address, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: WIF.address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: WIF.address, abi: erc20Abi, functionName: "name" }),
  ]);
  if (decimals !== WIF.decimals)
    throw new WifIdentityError(`$WIF decimals ${decimals}, expected 18`);
  if (symbol !== WIF.symbol)
    throw new WifIdentityError(`$WIF symbol ${symbol}, expected ${WIF.symbol}`);
  if (name !== WIF.name) throw new WifIdentityError(`$WIF name ${name}, expected ${WIF.name}`);
}

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((a) => getAddress(a));
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** packages/contracts/deployments/4663.json, written by `pnpm contracts:deploy:mainnet`. */
export const electionsDeploymentSchema = z.object({
  chainId: z.number().int(),
  elections: address,
  wif: address,
  owner: address,
  deployer: address,
  block: z.number().int().nonnegative(),
  transactions: z.array(
    z.object({
      contract: z.string(),
      address: address.nullable(),
      hash: txHash,
      block: z.number().int(),
    }),
  ),
  constructorArgs: z.array(z.string()),
  sourceHash: z.string(),
  gitSha: z.string(),
  compiler: z.string(),
  deployedAt: z.string(),
  explorer: z.string(),
  verified: z.boolean().optional(),
});
export type ElectionsDeployment = z.infer<typeof electionsDeploymentSchema>;

export const DEFAULT_ELECTIONS_DEPLOYMENT_FILE = join(
  import.meta.dirname,
  "..",
  "..",
  "contracts",
  "deployments",
  "4663.json",
);

/** Null when SuiemElections is not deployed yet (elections unavailable). */
export function loadElectionsDeployment(
  file: string = DEFAULT_ELECTIONS_DEPLOYMENT_FILE,
): ElectionsDeployment | null {
  if (!existsSync(file)) return null;
  const d = electionsDeploymentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (d.wif !== WIF.address && d.chainId === ELECTIONS_CHAIN_ID)
    throw new WifIdentityError("deployment manifest names a different $WIF address");
  return d;
}

/** Whole $WIF base units → vote count string for display ("3"). */
export const votesFromAmount = (amount: bigint) => amount / TOKEN_PER_VOTE;
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
