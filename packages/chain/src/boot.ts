import { assertChainId, ChainMismatchError, type SuiemChainId } from "@suiem/config/chains";
import type { PublicClient } from "viem";

export { ChainMismatchError };

/** Boot-time check: refuse to start unless the RPC reports exactly the expected chain. */
export async function assertSuiemChain(
  client: Pick<PublicClient, "getChainId">,
  expected: SuiemChainId,
): Promise<number> {
  let actual: number;
  try {
    actual = await client.getChainId();
  } catch (error) {
    throw new Error(`Could not read eth_chainId for chain ${expected}; refusing to start.`, {
      cause: error,
    });
  }
  assertChainId(actual, expected);
  return actual;
}
