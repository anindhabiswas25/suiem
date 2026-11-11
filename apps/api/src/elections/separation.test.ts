import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Votes and winners never write to reputation_* (ADR-0005). Election and indexer sources (and the
 * owner CLI) must not contain an INSERT/UPDATE/DELETE against any reputation_* table.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const DIRS = ["apps/api/src/elections", "workers/indexer/src"];
const FILES = ["scripts/elections-create.ts", "scripts/wif-vote.ts"];
const WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+reputation_/i;

function* walk(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(n) && !n.endsWith(".test.ts")) yield p;
  }
}

describe("elections never write reputation", () => {
  test("no reputation_* writes in election code", () => {
    const files = [
      ...DIRS.flatMap((d) => [...walk(join(ROOT, d))]),
      ...FILES.map((f) => join(ROOT, f)),
    ];
    const hits = files
      .filter((f) => {
        try {
          return WRITE.test(readFileSync(f, "utf8"));
        } catch {
          return false;
        }
      })
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  test("the scanner detects a write (self-test)", () => {
    expect(WRITE.test("UPDATE reputation_snapshots SET x = 1")).toBe(true);
  });
});
