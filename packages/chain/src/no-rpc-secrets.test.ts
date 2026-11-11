import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The PO's QuickNode URL carries its auth token, so it must never be committed (Sprint 7).
 * Fails if any tracked file contains `quiknode.pro`, except the redaction code and its tests,
 * which only ever hold the pattern (never a real endpoint).
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const ALLOWED = new Set([
  "packages/chain/src/rpc.ts",
  "packages/chain/src/rpc.test.ts",
  "packages/chain/src/no-rpc-secrets.test.ts",
  "apps/api/src/observability/redact.ts",
  "apps/api/src/observability/redact.test.ts",
]);
const NEEDLE = ["quiknode", "pro"].join(".");

describe("no secret RPC endpoint in tracked files", () => {
  test(`no tracked file mentions ${NEEDLE} (outside the redaction code)`, () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
      .toString()
      .split("\0")
      .filter(Boolean);
    const hits = files.filter((f) => {
      if (ALLOWED.has(f)) return false;
      try {
        return readFileSync(join(ROOT, f), "utf8").toLowerCase().includes(NEEDLE);
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
  });

  test("allowed files never contain a token-shaped endpoint", () => {
    const real = /https?:\/\/[a-z0-9-]+\.[a-z0-9.-]*quiknode\.pro\/[0-9a-f]{16,}/i;
    for (const f of ALLOWED) expect(real.test(readFileSync(join(ROOT, f), "utf8")), f).toBe(false);
  });
});
