import { describe, expect, test } from "vitest";
import {
  applyFill,
  averageCost,
  fromUnits,
  minOutFor,
  priceToUnits,
  replay,
  simulatedPrice,
  toUnits,
  tradeOut,
  valueOf,
} from "./math";

describe("order math (bigint, no floats)", () => {
  test("exact 6 ↔ 18 decimal conversion", () => {
    expect(toUnits("100", 6)).toBe(100_000_000n);
    expect(toUnits("0.000001", 6)).toBe(1n);
    expect(() => toUnits("0.0000001", 6)).toThrow(); // more precision than dUSD has
    expect(toUnits("0.3996", 18)).toBe(399_600_000_000_000_000n);
    expect(fromUnits(399_600_000_000_000_000n, 18)).toBe("0.3996");
    expect(fromUnits(1n, 18)).toBe("0.000000000000000001");
    expect(priceToUnits("168.89")).toBe(168_890_000n);
    expect(priceToUnits("0.0000005")).toBe(0n); // half-even: 0.5 → 0
    expect(priceToUnits("0.0000015")).toBe(2n);
    expect(valueOf(toUnits("2", 18), priceToUnits("250"))).toBe(500_000_000n);
  });

  test("trade output matches the venue contract (same vectors as the Foundry test)", () => {
    expect(tradeOut("buy", 100_000_000n, 250_000_000n, 10)).toEqual({
      out: 399_600_000_000_000_000n,
      fee: 100_000n,
    });
    expect(tradeOut("sell", 399_600_000_000_000_000n, 250_000_000n, 10)).toEqual({
      out: 99_800_100n,
      fee: 99_900n,
    });
    expect(tradeOut("buy", 10_000_000n, 200_000_000n, 0)).toEqual({
      out: 50_000_000_000_000_000n,
      fee: 0n,
    });
  });

  test("simulated slippage always goes against the trader; minOut rounds down", () => {
    expect(simulatedPrice("buy", 100_000_000n, 5)).toBe(100_050_000n);
    expect(simulatedPrice("sell", 100_000_000n, 5)).toBe(99_950_000n);
    expect(simulatedPrice("buy", 3n, 5)).toBe(4n); // rounds up for buys
    expect(minOutFor(1000n, 50)).toBe(995n);
    expect(minOutFor(1n, 50)).toBe(0n);
  });

  test("average cost: buys add cost; sells remove proportional cost and realize P&L", () => {
    const one = 10n ** 18n;
    let p = replay([
      { side: "buy", quantity: 2n * one, cash: 200_000_000n }, // 2 @ 100
      { side: "buy", quantity: 2n * one, cash: 300_000_000n }, // 2 @ 150
    ]);
    expect(p).toEqual({ quantity: 4n * one, costBasis: 500_000_000n, realized: 0n });
    expect(averageCost(p)).toBe(125_000_000n);
    p = applyFill(p, { side: "sell", quantity: one, cash: 160_000_000n }); // sell 1 @ 160
    expect(p).toEqual({ quantity: 3n * one, costBasis: 375_000_000n, realized: 35_000_000n });
    expect(averageCost(p)).toBe(125_000_000n); // average cost unchanged by a sell
    p = applyFill(p, { side: "sell", quantity: 3n * one, cash: 300_000_000n }); // close at 100
    expect(p).toEqual({ quantity: 0n, costBasis: 0n, realized: -40_000_000n });
    expect(averageCost(p)).toBeNull();
    expect(() => applyFill(p, { side: "sell", quantity: 1n, cash: 1n })).toThrow(/exceeds/);
  });

  test("odd quantities: cost removed is rounded half-even and closing removes exactly the rest", () => {
    let p = replay([{ side: "buy", quantity: 3n, cash: 10n }]);
    p = applyFill(p, { side: "sell", quantity: 1n, cash: 4n }); // removes round(10/3)=3
    expect(p).toEqual({ quantity: 2n, costBasis: 7n, realized: 1n });
    p = applyFill(p, { side: "sell", quantity: 2n, cash: 6n });
    expect(p).toEqual({ quantity: 0n, costBasis: 0n, realized: 0n });
  });
});
