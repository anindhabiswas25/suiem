// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/** Viem/ethers APIs that sign, send or encode state-changing calls. Phase 2 has no write path. */
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
      "reference-banchor/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "packages/contracts/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
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
  // Phase 2 rule (ADR-0001, PHASE_2 acceptance): no chain write builders anywhere in app code.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "workers/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "viem",
              importNames: CHAIN_WRITE_APIS,
              message: "Chain write builders are not allowed in Phase 2.",
            },
            {
              name: "wagmi",
              importNames: ["useWriteContract", "useSendTransaction", "useDeployContract"],
              message: "Chain writes are not allowed in Phase 2.",
            },
            {
              name: "wagmi/actions",
              importNames: ["writeContract", "sendTransaction", "deployContract"],
              message: "Chain writes are not allowed in Phase 2.",
            },
            { name: "ethers", message: "Suiem uses viem exclusively (ADR-0009)." },
          ],
          patterns: [
            {
              group: ["reference-banchor/*", "**/reference-banchor/**"],
              message: "Never import reference-banchor.",
            },
          ],
        },
      ],
    },
  },
  // Money modules: no floating point, ever (PRD §14, §19.5).
  {
    files: ["packages/shared/src/money/**/*.ts"],
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
      "packages/db/src/scripts/**/*.ts",
    ],
    rules: { "no-console": "off" },
  },
  prettier,
);
