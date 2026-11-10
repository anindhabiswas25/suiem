import fc from "fast-check";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  MoneyError,
  add,
  amount,
  divRound,
  formatAmount,
  fromDbUnits,
  mulRatio,
  parseAmount,
  rescale,
  sub,
  toDbUnits,
} from "./amount";
import { addFiat, fiat, formatFiat, fromDbNumeric, toDbNumeric } from "./fiat";
const decimalsArb = fc.integer({ min: 0, max: 36 });
const unitsArb = fc.bigInt({ min: -(10n ** 60n), max: 10n ** 60n });
/** Reference implementation using only string/bigint arithmetic. */
function refDivHalfEven(n, d) {
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  const r = a % d;
  if (r * 2n > d || (r * 2n === d && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}
describe("money: property tests", () => {
  test("format → parse round-trips exactly for any units and decimals", () => {
    fc.assert(
      fc.property(unitsArb, decimalsArb, (units, decimals) => {
        const a = amount(units, decimals);
        expect(parseAmount(formatAmount(a), decimals)).toEqual(a);
        expect(parseAmount(formatAmount(a, { trimZeros: false }), decimals)).toEqual(a);
      }),
      { numRuns: 2000 },
    );
  });
  test("formatted output never contains an exponent or more than one dot", () => {
    fc.assert(
      fc.property(unitsArb, decimalsArb, (units, decimals) => {
        const s = formatAmount(amount(units, decimals));
        expect(s).toMatch(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/);
      }),
    );
  });
  test("scaling up then down is lossless", () => {
    fc.assert(
      fc.property(unitsArb, decimalsArb, decimalsArb, (units, d1, d2) => {
        const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
        const a = amount(units, lo);
        expect(rescale(rescale(a, hi), lo, "exact")).toEqual(a);
      }),
    );
  });
  test("halfEven division matches the reference implementation", () => {
    fc.assert(
      fc.property(unitsArb, fc.bigInt({ min: 1n, max: 10n ** 20n }), (n, d) => {
        expect(divRound(n, d, "halfEven")).toBe(refDivHalfEven(n, d));
      }),
    );
  });
  test("floor ≤ exact quotient ≤ ceil, and they differ by at most one unit", () => {
    fc.assert(
      fc.property(unitsArb, fc.bigInt({ min: 1n, max: 10n ** 12n }), (n, d) => {
        const f = divRound(n, d, "floor");
        const c = divRound(n, d, "ceil");
        expect(f * d <= n).toBe(true);
        expect(c * d >= n).toBe(true);
        expect(c - f <= 1n).toBe(true);
      }),
    );
  });
  test("add/sub are inverse and commutative", () => {
    fc.assert(
      fc.property(unitsArb, unitsArb, decimalsArb, (x, y, d) => {
        const a = amount(x, d);
        const b = amount(y, d);
        expect(sub(add(a, b), b)).toEqual(a);
        expect(add(a, b)).toEqual(add(b, a));
      }),
    );
  });
  test("parse of any well-formed decimal string preserves its digits exactly", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 40n }),
        fc.stringMatching(/^[0-9]{0,18}$/),
        (whole, frac) => {
          const text = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
          const a = parseAmount(text, 18);
          expect(formatAmount(a, { trimZeros: false })).toBe(`${whole}.${frac.padEnd(18, "0")}`);
        },
      ),
    );
  });
});
describe("money: exact conversion examples", () => {
  test("classic float traps are exact", () => {
    expect(formatAmount(add(parseAmount("0.1", 18), parseAmount("0.2", 18)))).toBe("0.3");
    expect(formatAmount(parseAmount("1.005", 3))).toBe("1.005");
    expect(parseAmount("123456789012345678901234567890.123456789012345678", 18).units).toBe(
      123456789012345678901234567890123456789012345678n,
    );
  });
  test("too many decimals is rejected unless a rounding mode is chosen", () => {
    expect(() => parseAmount("1.2345678", 6)).toThrow(MoneyError);
    expect(formatAmount(parseAmount("1.2345675", 6, "halfEven"))).toBe("1.234568");
    expect(formatAmount(parseAmount("1.2345665", 6, "halfEven"))).toBe("1.234566");
    expect(formatAmount(parseAmount("-1.2345678", 6, "floor"))).toBe("-1.234568");
  });
  test("pro-rata split with mulRatio never invents value", () => {
    const total = parseAmount("100", 6);
    const third = mulRatio(total, 1n, 3n, "floor");
    expect(formatAmount(third)).toBe("33.333333");
    expect(() => mulRatio(total, 1n, 3n, "exact")).toThrow(MoneyError);
  });
  test("mixing decimals is an error, not a silent conversion", () => {
    expect(() => add(parseAmount("1", 6), parseAmount("1", 18))).toThrow(/different decimals/);
  });
  test("database round-trip for numeric(78,0)", () => {
    const a = parseAmount("42.5", 18);
    expect(fromDbUnits(toDbUnits(a), 18)).toEqual(a);
    expect(() => toDbUnits(amount(10n ** 78n, 0))).toThrow(/numeric\(78,0\)/);
    expect(() => fromDbUnits("1.5", 18)).toThrow(MoneyError);
  });
});
describe("money: no JS numbers accepted", () => {
  test("number inputs are rejected at runtime", () => {
    expect(() => parseAmount(0.1, 18)).toThrow(/never a JS number/);
    expect(() => amount(1, 6)).toThrow(/never a JS number/);
    expect(() => mulRatio(parseAmount("1", 6), 1.5, 1n, "floor")).toThrow(/never a JS number/);
  });
  test("malformed strings are rejected", () => {
    for (const bad of [
      "1e3",
      "+1",
      ".5",
      "1.",
      " 1",
      "1 ",
      "1,000",
      "0x10",
      "NaN",
      "Infinity",
      "01",
      "-",
      "",
    ]) {
      expect(() => parseAmount(bad, 6), bad).toThrow(MoneyError);
    }
  });
  test("decimals must be an integer 0..36", () => {
    expect(() => parseAmount("1", 37)).toThrow(/0 to 36/);
    expect(() => parseAmount("1", 1.5)).toThrow(/0 to 36/);
  });
  test("money source files contain no float tokens (belt-and-braces for the lint rule)", () => {
    const dir = import.meta.dirname;
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/\bparseFloat\b|\bMath\.|\.toFixed\(|\bNumber\(|:\s*number\b/);
    }
  });
});
describe("fiat", () => {
  test("numeric(20,6) round-trip and formatting", () => {
    const f = fiat("1234.5", "USD");
    expect(toDbNumeric(f)).toBe("1234.500000");
    expect(fromDbNumeric("1234.500000", "USD")).toEqual(f);
    expect(formatFiat(f)).toBe("USD 1234.50");
  });
  test("currencies never mix and must be supported", () => {
    expect(() => addFiat(fiat("1", "USD"), fiat("1", "INR"))).toThrow(/different currencies/);
    expect(() => fiat("1", "XYZ")).toThrow(/unsupported currency/);
    expect(() => fiat("100000000000000", "USD")).toThrow(/numeric\(20,6\)/);
  });
});
