import { defineConfig } from "@playwright/test";

/**
 * Extension E2E. Runs the built, unpacked extension in Chromium against the REAL API
 * (Postgres + Redis containers, local anvils for the boot chain check), with a counting proxy in
 * front of the API so every network request the extension makes is observed.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
});
