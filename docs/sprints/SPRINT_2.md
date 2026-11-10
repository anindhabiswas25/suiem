# Sprint 2: Foundation + app shell

- Date: 2026-11-10 · Branch: `hackathon/main` · Brief: `prompts/PHASE_2_PROMPT.md` (hackathon version)
- Status: **complete, awaiting PO approval before Sprint 3.** No transactions sent, no contracts deployed, nothing pushed.

## Done criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| `docker compose up && pnpm i && pnpm db:migrate && pnpm db:seed && pnpm dev` runs web + API locally | ✅ | Run in this tree from an empty database on 2026-11-10. The API boot check passed on 4663 and 46630; web served all 17 routes with HTTP 200. Documented in `README.md` |
| Log in with SIWE (either chain) or passkey; consent stored with policy version + timestamp; onboarding finishes without a funded wallet; every nav route visible | ✅ | `api.int.test.ts`: "signs up on first use and logs in again on chain 4663/46630", "sign up, then log in with the passkey from a new browser", "passkey user (no wallet at all) accepts consent and finishes onboarding" (checks `consent_records` rows). Live smoke test through the web proxy on both chains. Every PRD §4.1 route exists (`next build` output) |
| SIWE rejects wrong chain, wrong domain, expired message, replayed nonce | ✅ | `api.int.test.ts › SIWE … rejections`: "wrong chain in the message", "unsupported chain in the nonce request", "wrong domain", "wrong URI", "expired message", "replayed nonce", "signature from a different key", "a login nonce cannot be used to link a wallet" |
| Money library unit/property tests pass; no floats in money code | ✅ | `packages/shared/src/money/money.test.ts` (6 fast-check properties, 2,000+ runs each). ESLint rule bans `number`, `Number`, `Math`, `parseFloat`, `toFixed` and float literals in `packages/shared/src/money/**`. Source-scan test as backup |
| `trading.live` cannot be enabled | ✅ | `db.int.test.ts › trading.live is hard-off` (UPDATE, upsert, delete, rename all rejected). `api.int.test.ts › trading.live cannot be enabled through the service, env or config` (no env override exists) |
| Writes require CSRF and session | ✅ | `api.int.test.ts › writes require CSRF and a session` (missing/wrong token, foreign or missing Origin → 403; no session → 401; auth endpoints need CSRF too; logout revokes server-side) |
| Typecheck, lint, unit and integration tests pass | ✅ | Output below |
| `.env.example` lists every variable with a description and no values | ✅ | Generated from `packages/config/src/env.ts` (`pnpm env:example`) and checked by `env.test.ts` |

## Test output (2026-11-10)

```text
$ pnpm typecheck
 Tasks:    10 successful, 10 total

$ pnpm lint
eslint: 0 problems

$ pnpm format:check
All matched files use Prettier code style!

$ pnpm depcruise
✔ no dependency violations found (134 modules, 278 dependencies cruised)

$ pnpm test   (unit)
 Test Files  10 passed (10)
      Tests  55 passed (55)

$ pnpm test:integration   (Testcontainers Postgres 16 + Redis, local anvil)
 Test Files  3 passed (3)
      Tests  55 passed (55)

$ pnpm contracts:build
Nothing to compile
```

The dependency rules were demonstrated: a temporary `apps/extension` → `@suiem/chain` import and a `workers/research` → `@suiem/chain` import each failed `depcruise`, then were removed.

## What was built

| Item (brief §) | Where |
| --- | --- |
| 1 Monorepo: pnpm 11 + Turborepo, strict TS, ESLint, Prettier, Vitest, dependency-cruiser, exact pins, committed lockfile, install-script allowlist, 24h minimum release age (strict) | root, `packages/config/tsconfig` |
| 1 Empty-but-wired `apps/extension`, `workers/research`, `workers/indexer`, `packages/contracts` (Foundry) | placeholders with typecheck |
| 2 Local infra: Postgres 16, Redis; anvil forks of 4663 (:8546) and 46630 (:8547) under the `test` profile | `infra/docker-compose.yml`, `compose.yaml` |
| 3 Chains: `robinhoodMainnet`/`robinhoodTestnet` viem chains with VERIFIED_FACTS row IDs; `FEATURE_NETWORK` map; `assertChainId`; `WIF` constant on mainnet only | `packages/config/chains/` |
| 4 DB schema for the whole demo (36 tables), UUIDv7, `numeric(78,0)`+decimals, `numeric(20,6)`+currency, `book` with `live` blocked, append-only history, unique chain events; least-privilege API role; seed | `packages/db/migrations/`, `src/seed*.ts` |
| 5 Shared: API envelope, research brief v1 (PRD §7.3, citations enforced), extension messages, money, ids, consent state machine, WARC taxonomy | `packages/shared` |
| 6 Auth: WebAuthn register/login, SIWE login + linking (nonce, domain, URI, chain 4663/46630, expiry, single use), HttpOnly SameSite cookie, CSRF, rate limits, `GET/PATCH /me`, `GET/POST /me/consents` | `apps/api/src/auth`, `me` |
| 7 Web shell: wagmi + viem with both chains, network switcher, network badges, onboarding per PRD §5.1, all 14 nav routes with empty states, Settings (privacy + data export/delete stubs), Help & disclosures | `apps/web` |
| 8 Design system v0, Suiem wordmark, dark/light themes, status with icon + text, reduced motion, loading/empty/error states | `packages/ui` |
| 9 Flags: env + DB, `trading.live` hard-off; `trading.testnet`, `elections`, `campaigns`; server-side Stock Token jurisdiction check (restricted list) | `apps/api/src/flags`, `packages/config/src/jurisdictions.ts` |

## Security review follow-ups (automated review, fixed this sprint)

1. **Single superuser DB role** → the API now runs as `suiem_app` (NOSUPERUSER, NOBYPASSRLS, no DDL, no deletes on history, read-only flags). Migrations use `DATABASE_OWNER_URL`. Tests: `db.int.test.ts › least-privilege API role`.
2. **Forbidden-phrase scan missed brief fields** → it now walks every generated string field.
3. **`trustProxy: true` allowed X-Forwarded-For spoofing of the rate-limit key** → explicit `TRUST_PROXY_HOPS` (default 0). Test: "spoofed X-Forwarded-For values do not escape the per-IP auth limit".

## Deviations and things skipped

| Item | Why | Follow-up |
| --- | --- | --- |
| Full RLS | Deferred by PO (ADR-0010 §5). Least-privilege role kept; user scoping in repositories, with cross-user API tests | Post-hackathon |
| Idempotency-key interceptor | Not needed for Sprint 2 writes (all idempotent or single-use). Table exists | Sprint 5 (orders) |
| OpenTelemetry export | Deferred (ADR-0010 §5). Pino logs with allowlist redaction ship now | Post-hackathon |
| Data export / account deletion | UI stubs only, as the brief asked | Sprint 8 |
| Playwright E2E | Planned for Sprint 8 (golden path). API flows are covered by integration tests | Sprint 8 |
| Passkey in the browser not exercised automatically | Verified with a software authenticator against real `@simplewebauthn` verification; manual check needs a device | Sprint 8 E2E with a virtual authenticator |
| ERC-1271 / smart-wallet SIWE signatures | No smart accounts for the hackathon. EOA signatures only | — |
| Earlier work for the archived long-term brief (email OTP, dual control, OTel) | Removed or deferred after the scope change. Dual-control ADR kept as ADR-0011 (deferred) | — |
| First commit message | Was `docs: phase 1 discovery, architecture and ADRs`; brief asked for `docs: phase 1 discovery and architecture`. Not rewritten | — |

## New open questions

See `docs/decisions/OPEN_QUESTIONS.md` → Hackathon (OQ-H-01…H-06): repo visibility, jurisdiction source, re-reading the restricted list (S5-01), the $WIF burn-path check (S7-01), passkey-only voters, display names.
