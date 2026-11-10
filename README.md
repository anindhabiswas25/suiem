# Suiem

AI-assisted research, theses, social investing and community recognition, built for the **World is Flat** hackathon on Robinhood Chain.

> Suiem is not affiliated with Robinhood Markets, Inc. Testnet assets have no value and are not securities. $WIF carries no promise of value or return. Nothing here is investment advice.

| Feature | Network |
| --- | --- |
| $WIF elections (burn-to-vote) | Robinhood Chain **mainnet 4663** (real $WIF) |
| Stock Token demo | Robinhood Chain **testnet 46630** (no value) |
| Research, theses, social, reputation | Off-chain (Postgres) |

Plan: [`docs/HACKATHON_PLAN.md`](docs/HACKATHON_PLAN.md) · Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Decisions: [`docs/ADR/`](docs/ADR/README.md) · Verified chain facts: [`docs/VERIFIED_FACTS.md`](docs/VERIFIED_FACTS.md)

## Prerequisites

- Node **24.21+** (`.nvmrc`) and pnpm **11.17** (`corepack enable`)
- Docker with Compose v2.20+
- Foundry (`forge`, `anvil`) for contract builds and the boot/fork tests
- Internet access: the API checks `eth_chainId` on both Robinhood Chain RPCs at boot (read-only)

## Quickstart (clean clone)

```bash
docker compose up -d --wait   # Postgres 16 + Redis (local-only credentials)
pnpm i
pnpm db:migrate               # creates .env with local defaults on first run
pnpm db:seed                  # 30 entities, 5 unverified testnet Stock Token instruments, demo users
pnpm dev                      # web http://localhost:3000 · API http://localhost:4000/api/v1
```

Then open http://localhost:3000, sign in with a **passkey** or a **wallet** (SIWE on 4663 or 46630), accept the terms, and finish onboarding. No funded wallet is needed.

If port 5432 or 6379 is already taken, set `SUIEM_PG_PORT` / `SUIEM_REDIS_PORT` in `.env` and update `DATABASE_URL`, `DATABASE_OWNER_URL` and `REDIS_URL` to match.

## Tests and checks

```bash
pnpm typecheck          # all packages
pnpm lint               # ESLint, including the no-floats rule on money code and no chain-write builders
pnpm format:check
pnpm depcruise          # dependency rules (extension/research cannot import chain code)
pnpm test               # unit tests
pnpm test:integration   # Testcontainers Postgres 16 + Redis; spawns local anvil for boot checks
pnpm contracts:build
pnpm check              # all of the above
```

Anvil forks of mainnet and testnet (tests only, nothing is broadcast): `COMPOSE_PROFILES=test docker compose up -d`.

## Layout

```
apps/web          Next.js App Router (wagmi + viem, both chains)
apps/api          NestJS + Fastify, /api/v1, Zod validation, OpenAPI at /api/v1/openapi.json
apps/extension    Suiem Intelligence (Sprint 3)
packages/config   chains (4663, 46630), $WIF constant, feature→network map, env registry, restricted jurisdictions
packages/shared   Zod schemas, money library (bigint, no floats), consent state machine, research brief v1, events
packages/db       SQL migrations, Drizzle schema, seed
packages/chain    read-only viem clients, boot chain-ID assertion
packages/ui       design system v0
packages/contracts Foundry (Sprint 7)
workers/*         research (Sprint 4), indexer (Sprint 7)
```

Environment variables: see [`.env.example`](.env.example) (names and descriptions only; regenerate with `pnpm env:example`).
