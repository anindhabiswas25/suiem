/** Dependency rules from ARCHITECTURE §9 and ADR-0006/0009. CI fails on any violation. */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "extension-no-chain",
      comment: "The extension never touches chain code (ADR-0001, PRD §6.7).",
      severity: "error",
      from: { path: "^apps/extension", pathNot: "^apps/extension/e2e" },
      to: { path: "(^packages/chain|node_modules/viem|node_modules/wagmi|@suiem/chain)" },
    },
    {
      name: "research-no-chain-writers",
      comment:
        "Research worker must not depend on chain write builders or the order module (ADR-0006).",
      severity: "error",
      from: { path: "^workers/research" },
      to: { path: "(^packages/chain/src/write|^apps/api/src/(orders|wallet)|@suiem/chain/write)" },
    },
    {
      name: "research-no-chain-code",
      comment: "Research never imports chain code, read or write (ADR-0006).",
      severity: "error",
      from: { path: "^workers/research" },
      to: { path: "(^packages/chain|@suiem/chain|node_modules/viem|node_modules/wagmi)" },
    },
    {
      name: "reputation-no-economy",
      comment:
        "The Suiem Score never depends on elections, $WIF, chain code or token balances (ADR-0005, PRD §10.4).",
      severity: "error",
      from: { path: "^(workers/reputation|apps/api/src/social)" },
      to: {
        path: "(^packages/chain|@suiem/chain|node_modules/(viem|wagmi)|^workers/indexer|^apps/api/src/(orders|elections|wallet)|elections|wif)",
      },
    },
    {
      name: "shared-no-io",
      comment: "packages/shared is pure: no runtime I/O dependencies.",
      severity: "error",
      from: { path: "^packages/shared/src", pathNot: "\\.test\\.(ts|js)$" },
      to: {
        path: "(node_modules/(pg|ioredis|viem|next|react|fastify|@nestjs)|^packages/(db|chain)|^apps/)|^(fs|net|http|https|child_process|node:fs|node:net|node:http|node:https|node:child_process)$",
      },
    },
    {
      name: "packages-not-apps",
      comment: "Libraries never import applications.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "web-no-db-or-api-internals",
      comment: "The web app talks to the API over HTTP only.",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "(^packages/db|^apps/api)" },
    },
    {
      name: "system-db-only-in-privileged-modules",
      comment:
        "The RLS-bypassing system DB handle is only usable by auth, admin, flags, wallet-nonce and infra modules.",
      severity: "error",
      from: {
        path: "^apps/api/src",
        pathNot:
          "^apps/api/src/(auth|admin|flags|infra|wallet|idempotency|audit|observability|main\\.ts|app\\.module\\.ts)|\\.test\\.ts$|^apps/api/test",
      },
      to: { path: "^apps/api/src/infra/system-db" },
    },
    {
      name: "no-reference-banchor",
      severity: "error",
      from: {},
      to: { path: "reference-banchor" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|\\.next|dist|coverage|packages/contracts)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
    combinedDependencies: true,
  },
};
