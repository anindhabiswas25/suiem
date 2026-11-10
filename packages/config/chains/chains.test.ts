import { describe, expect, test } from "vitest";
import {
  assertChainId,
  ChainMismatchError,
  chainForFeature,
  FEATURE_NETWORK,
  NETWORK_BADGE,
  networkOfChain,
  robinhoodMainnet,
  robinhoodTestnet,
  WIF,
  wifForChain,
} from "./index";
import { stockTokenEligibility, STOCK_TOKEN_RESTRICTED } from "../src/jurisdictions";

describe("chains", () => {
  test("mainnet and testnet use the verified IDs, RPCs and explorers", () => {
    expect(robinhoodMainnet.id).toBe(4663);
    expect(robinhoodMainnet.rpcUrls.default.http[0]).toBe(
      "https://rpc.mainnet.chain.robinhood.com",
    );
    expect(robinhoodMainnet.blockExplorers.default.url).toBe(
      "https://robinhoodchain.blockscout.com",
    );
    expect(robinhoodTestnet.id).toBe(46630);
    expect(robinhoodTestnet.rpcUrls.default.http[0]).toBe(
      "https://rpc.testnet.chain.robinhood.com",
    );
    expect(robinhoodTestnet.testnet).toBe(true);
  });

  test("$WIF exists only on mainnet", () => {
    expect(WIF).toMatchObject({
      chainId: 4663,
      decimals: 18,
      address: "0x5173b8eA6923c2d40267890D45C46a3480954773",
    });
    expect(() => wifForChain(46630)).toThrow(/only on chain 4663/);
  });

  test("feature → network map follows ADR-0010", () => {
    expect(chainForFeature("wif.elections")).toBe(4663);
    expect(chainForFeature("invest.stock_tokens")).toBe(46630);
    expect(chainForFeature("research")).toBeNull();
    expect(FEATURE_NETWORK.reputation).toBe("offchain");
    expect(NETWORK_BADGE.mainnet.label).toContain("real $WIF");
    expect(NETWORK_BADGE.testnet.label).toContain("no value");
    expect(networkOfChain(1)).toBeNull();
  });

  test("assertChainId", () => {
    expect(() => assertChainId(4663, 4663)).not.toThrow();
    expect(() => assertChainId(46630, 4663)).toThrow(ChainMismatchError);
    expect(() => assertChainId(1, 46630)).toThrow(/expected 46630/);
  });
});

describe("stock token jurisdiction check", () => {
  test("blocks every restricted jurisdiction and undeclared ones", () => {
    for (const j of STOCK_TOKEN_RESTRICTED)
      expect(stockTokenEligibility(j)).toEqual({
        eligible: false,
        reason: "restricted_jurisdiction",
      });
    for (const j of [null, undefined, "", "ZZ", "in", "IND"]) {
      expect(stockTokenEligibility(j)).toEqual({
        eligible: false,
        reason: "jurisdiction_not_declared",
      });
    }
    expect(stockTokenEligibility("IN")).toEqual({ eligible: true });
    expect(stockTokenEligibility("DE")).toEqual({ eligible: true });
  });
});
