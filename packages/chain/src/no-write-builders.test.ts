import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Phase 2 acceptance: "No order or token-transfer code path exists." Together with the ESLint
 * `no-restricted-imports` rule, this scans every source file for chain write builders.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const SCAN = ["apps", "packages", "workers"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "out",
  "cache",
  "test-results",
  "playwright-report",
  "contracts",
]);
const FORBIDDEN = [
  "createWalletClient",
  "writeContract",
  "sendTransaction",
  "sendRawTransaction",
  "signTransaction",
  "encodeFunctionData",
  "prepareTransactionRequest",
  "sendUserOperation",
  "deployContract",
  "useWriteContract",
  "useSendTransaction",
  "eth_sendTransaction",
  "eth_sendRawTransaction",
];

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !/\.(test|int\.test|spec)\.tsx?$/.test(name))
      yield path;
  }
}

/**
 * Sprint 5: chain writes exist ONLY in these reviewed places (testnet 46630 demo venue). Anything
 * else that references a write builder fails this test.
 */
const ALLOWED = [
  /^packages\/chain\/src\/write\//,
  /^apps\/web\/components\/invest\//,
  /^scripts\/(deploy-testnet|invest-smoke)\.ts$/,
  // Sprint 7 (mainnet 4663, real $WIF): deploy, owner CLI and the PO's own vote tool.
  /^scripts\/(deploy-mainnet|elections-create|wif-vote)\.ts$/,
];

describe("chain writes exist only in the reviewed testnet modules", () => {
  test("no source file references a chain write builder", () => {
    const hits: string[] = [];
    for (const top of SCAN) {
      for (const file of sourceFiles(join(ROOT, top))) {
        if (ALLOWED.some((re) => re.test(relative(ROOT, file)))) continue;
        const text = readFileSync(file, "utf8");
        for (const word of FORBIDDEN)
          if (new RegExp(`\\b${word}\\b`).test(text)) hits.push(`${relative(ROOT, file)}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("the scanner itself detects a write builder (self-test)", () => {
    expect(
      FORBIDDEN.some((w) => new RegExp(`\\b${w}\\b`).test("const c = createWalletClient({})")),
    ).toBe(true);
  });
});
