# workers/reputation (`@suiem/reputation`)

The Suiem Score (PRD §10, ADR-0005, `docs/REPUTATION_METHODOLOGY.md`).

- `src/engine/`: the **pure, deterministic** engine. `score(evidence, methodology) → snapshot`
  uses integer arithmetic only (ppm ratios, micro-points, half-even rounding through
  `@suiem/shared/money`). `evaluateThesis` checks a frozen thesis v1 against SPY.
- `src/collect.ts`: builds the engine's evidence from the database (reconciled fills,
  thesis evaluations, published research, weighted votes).
- `src/jobs.ts`: benchmark marks (SPY), thesis evaluation at horizon end (append-only),
  snapshot writes on change, and an in-process loop that runs at least hourly. The API starts
  it at boot (`REPUTATION_JOBS=inline`, the default).

No dependency on elections, $WIF, chain code or token balances (depcruise rule
`reputation-no-economy`).
