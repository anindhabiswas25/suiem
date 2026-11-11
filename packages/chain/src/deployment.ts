import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { z } from "zod";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((a) => getAddress(a));
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** packages/contracts/deployments/46630.json, written by `pnpm contracts:deploy:testnet`. */
export const demoDeploymentSchema = z.object({
  chainId: z.literal(46630),
  venue: address,
  dusd: address,
  tokens: z.record(z.string(), address),
  deployer: address,
  quoteSigner: address,
  block: z.number().int().nonnegative(),
  transactions: z.array(
    z.object({
      contract: z.string(),
      address: address.nullable(),
      hash: txHash,
      arguments: z.array(z.string()).nullable(),
    }),
  ),
  gitSha: z.string(),
  compiler: z.string(),
  deployedAt: z.string(),
  explorer: z.string(),
  verified: z.record(z.string(), z.boolean()).optional(),
});
export type DemoDeployment = z.infer<typeof demoDeploymentSchema>;

export const DEFAULT_DEPLOYMENT_FILE = join(
  import.meta.dirname,
  "..",
  "..",
  "contracts",
  "deployments",
  "46630.json",
);

/** Loads and validates the manifest; null when the venue is not deployed (testnet trading unavailable). */
export function loadDemoDeployment(file: string = DEFAULT_DEPLOYMENT_FILE): DemoDeployment | null {
  if (!existsSync(file)) return null;
  return demoDeploymentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
