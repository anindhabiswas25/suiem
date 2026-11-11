import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/** Reputation code has no path to $WIF, elections, chain code or token balances (ADR-0005). */
describe("reputation-no-economy (source scan)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory()
        ? files(p)
        : p.endsWith(".ts") && !p.endsWith(".test.ts")
          ? [p]
          : [];
    });
  const src = [
    ...files(join(import.meta.dirname, "..")),
    ...files(join(import.meta.dirname, "../../../../apps/api/src/social")),
  ];
  test.each(src)("%s", (f) => {
    const code = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      // The published integrity rules and the never-counted list may NAME $WIF to exclude it.
      .replace(/"[^"\n]*(\$WIF|elections)[^"\n]*"/g, '""');
    expect(code).not.toMatch(
      /\bwif\b|election|chain_events|wallet_accounts.*balance|balanceOf|@suiem\/chain|from "viem"/i,
    );
  });
});
