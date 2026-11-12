// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/** Viem/ethers APIs that sign, send or encode state-changing calls. Only reviewed builders in packages/chain may use them. */
const CHAIN_WRITE_APIS = [
  "createWalletClient",
  "writeContract",
  "sendTransaction",
  "sendRawTransaction",
  "signTransaction",
  "encodeFunctionData",
  "prepareTransactionRequest",
  "sendUserOperation",
  "deployContract",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "packages/contracts/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "**/.wxt/**",
      "**/.output/**",
      "**/.output-e2e/**",
      // vendored Webflow export (licensed Catalis template)
      "apps/web/public/landing/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
      eqeqeq: ["error", "always"],
    },
  },
  // ADR-0001: no ad-hoc chain write builders in app code; writes go through reviewed builders only.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "workers/**/*.{ts,tsx}"],
    // Sprint 5: the reviewed testnet write modules (see packages/chain/src/no-write-builders.test.ts).
    // Allowed write paths: testnet orders and mainnet burn-to-vote. Both send only calldata the
    // API built and previewed, from the user's own wallet after explicit confirmation.
    ignores: [
      "packages/chain/src/write/**",
      "apps/web/components/invest/**",
      "apps/web/components/elections/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "viem",
              importNames: CHAIN_WRITE_APIS,
              message: "Use the reviewed chain write builders in packages/chain.",
            },
            {
              name: "wagmi",
              importNames: ["useWriteContract", "useSendTransaction", "useDeployContract"],
              message: "Use the reviewed chain write builders in packages/chain.",
            },
            {
              name: "wagmi/actions",
              importNames: ["writeContract", "sendTransaction", "deployContract"],
              message: "Use the reviewed chain write builders in packages/chain.",
            },
            { name: "ethers", message: "Suiem uses viem exclusively (ADR-0009)." },
          ],
        },
      ],
    },
  },
  // Order and portfolio code: amounts are bigint/strings; no float parsing or formatting (PRD §19.5).
  {
    files: ["apps/api/src/orders/**/*.ts", "packages/chain/src/write/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "No floats in order code." },
        { name: "parseInt", message: "No parseInt for amounts; use bigint." },
      ],
      "no-restricted-properties": [
        "error",
        { property: "toFixed", message: "No float formatting in order code." },
        { property: "toPrecision", message: "No float formatting in order code." },
      ],
    },
  },
  // Money modules: no floating point, ever (PRD §14, §19.5).
  {
    files: ["packages/shared/src/money/**/*.ts", "apps/api/src/orders/math.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "No floats in money code." },
        { name: "Number", message: "No Number conversions in money code; use bigint." },
        { name: "Math", message: "No Math in money code; use bigint arithmetic." },
      ],
      "no-restricted-properties": [
        "error",
        { property: "toFixed", message: "No float formatting in money code." },
        { object: "Number", message: "No Number in money code." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[raw=/^[0-9]*\\.[0-9]+$|e-/i]",
          message: "No floating-point literals in money code.",
        },
        {
          selector: "TSNumberKeyword",
          message: "Money values must be bigint or string, never number.",
        },
        {
          selector: "BinaryExpression[operator='/'] > Literal[value=/./]",
          message: "Use bigint division helpers.",
        },
      ],
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/test/**/*.ts",
      "**/e2e/**/*.ts",
      "scripts/**/*.ts",
      "scripts/**/*.mjs",
      "packages/db/src/scripts/**/*.ts",
      "apps/**/src/scripts/**/*.ts",
      "workers/**/src/scripts/**/*.ts",
      "apps/extension/scripts/**/*.mjs",
    ],
    rules: { "no-console": "off" },
  },
  // Extension: core/net.ts is the ONLY module allowed to touch the network (Sprint 3, ADR-0003 §1).
  {
    files: ["apps/extension/src/**/*.{ts,tsx}"],
    ignores: ["apps/extension/src/core/net.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Only src/core/net.ts may call the network (it enforces OFF/PAUSED/PRIVATE).",
        },
        { name: "XMLHttpRequest", message: "Only src/core/net.ts may call the network." },
        { name: "WebSocket", message: "Only src/core/net.ts may call the network." },
        { name: "EventSource", message: "Only src/core/net.ts may call the network." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "navigator", property: "sendBeacon", message: "No beacons from the extension." },
        {
          object: "window",
          property: "fetch",
          message: "Only src/core/net.ts may call the network.",
        },
        {
          object: "globalThis",
          property: "fetch",
          message: "Only src/core/net.ts may call the network.",
        },
      ],
    },
  },
  prettier,
);
