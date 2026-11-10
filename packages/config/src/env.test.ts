import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ENV_VARS, loadApiEnv } from "./env";

const root = join(import.meta.dirname, "..", "..", "..");

describe(".env.example", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const lines = example.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l));

  test("lists every variable the code reads", () => {
    const keys = lines.map((l) => l.split("=")[0]);
    expect(new Set(keys)).toEqual(new Set(Object.keys(ENV_VARS)));
  });

  test("contains no values", () => {
    for (const line of lines) expect(line.split("=")[1]).toBe("");
  });

  test("every variable has a description comment", () => {
    for (const key of Object.keys(ENV_VARS)) {
      const idx = example.indexOf(`\n${key}=`);
      const before = example.slice(0, idx).split("\n").pop() ?? "";
      expect(before.startsWith("#"), key).toBe(true);
    }
  });
});

describe("loadApiEnv", () => {
  const base = {
    WEB_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgres://a",
    REDIS_URL: "redis://c",
    SESSION_SECRET: "x".repeat(32),
    WEBAUTHN_RP_ID: "localhost",
  };

  test("refuses disabled rate limits in production", () => {
    expect(() =>
      loadApiEnv({ ...base, NODE_ENV: "production", RATE_LIMIT_DISABLED: "true" }),
    ).toThrow(/forbidden in production/);
  });

  test("error messages never echo secret values", () => {
    try {
      loadApiEnv({ ...base, SESSION_SECRET: "short-secret-value" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("SESSION_SECRET");
      expect(String(e)).not.toContain("short-secret-value");
    }
  });
});
