import { defineConfig } from "vitest/config";

const exclude = [
  "**/node_modules/**",
  "**/.next/**",
  "reference-banchor/**",
  "**/e2e/**",
  "**/dist/**",
];

export default defineConfig({
  // Web component tests render React with the automatic JSX runtime (react-dom/server, no DOM needed).
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts", "workers/**/*.test.ts"],
          exclude: [...exclude, "**/*.int.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: [
            "apps/**/*.int.test.ts",
            "packages/**/*.int.test.ts",
            "workers/**/*.int.test.ts",
          ],
          exclude,
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
          globalSetup: ["./apps/api/test/global-setup.ts"],
        },
      },
    ],
  },
});
