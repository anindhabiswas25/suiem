import { describe, expect, test } from "vitest";
import {
  assertSuiemChain,
  ChainMismatchError,
  rpcUrls,
  UnavailableSmartAccountProvider,
} from "./index";

describe("rpc selection", () => {
  test("public by default; Alchemy primary with public fallback when keyed; override wins", () => {
    expect(rpcUrls({ chainId: 4663 })).toEqual(["https://rpc.mainnet.chain.robinhood.com"]);
    expect(rpcUrls({ chainId: 46630, alchemyApiKey: "k" })).toEqual([
      "https://robinhood-testnet.g.alchemy.com/v2/k",
      "https://rpc.testnet.chain.robinhood.com",
    ]);
    expect(rpcUrls({ chainId: 4663, rpcUrl: "http://127.0.0.1:8546", alchemyApiKey: "k" })).toEqual(
      ["http://127.0.0.1:8546"],
    );
  });
});

describe("assertSuiemChain", () => {
  test("accepts the expected chain and refuses others", async () => {
    await expect(assertSuiemChain({ getChainId: async () => 4663 }, 4663)).resolves.toBe(4663);
    await expect(assertSuiemChain({ getChainId: async () => 46630 }, 46630)).resolves.toBe(46630);
    for (const id of [1, 10143, 31337, 46630]) {
      await expect(assertSuiemChain({ getChainId: async () => id }, 4663)).rejects.toBeInstanceOf(
        ChainMismatchError,
      );
    }
  });
  test("refuses when the RPC is unreachable", async () => {
    await expect(
      assertSuiemChain({ getChainId: () => Promise.reject(new Error("down")) }, 46630),
    ).rejects.toThrow(/refusing to start/);
  });
});

test("smart accounts are stubbed (no smart accounts for the hackathon)", async () => {
  await expect(new UnavailableSmartAccountProvider().getAccountAddress()).rejects.toThrow();
});
