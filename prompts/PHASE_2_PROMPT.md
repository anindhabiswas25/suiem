You are the staff engineer for Suiem. Phase 1 (discovery and architecture) is complete and APPROVED by the product owner. This is PHASE 2 of 8: Platform Foundation. Target: Robinhood Chain TESTNET 46630 only. No mainnet, no real funds, no real securities.

## Read first (in this order, completely)

1. `PRD.md`, focusing on §0.2, §5.1, §13–§16, §19, §20, §22 and §24
2. `docs/IMPLEMENTATION_PLAN.md`: the Phase 2 section (epics E2.1–E2.11, acceptance and exit criteria) is your contract
3. `docs/ARCHITECTURE.md`: §5 trust boundaries, §6 data model conventions, §7 stack, §8 threat model (TM-01, TM-17, TM-18 and TM-19 are Phase 2 exit items), §9 monorepo layout and dependency rules
4. `docs/ADR/0002-chain-and-wallet.md`, `0003-data-and-privacy.md`, `0009-monorepo-and-stack.md`, and `docs/ADR/README.md`
5. `docs/VERIFIED_FACTS.md` and `docs/decisions/OPEN_QUESTIONS.md`

Do not re-audit `reference-banchor/`. It is read-only reference material, and none of its code is copied in this phase.

## Product-owner decisions for Phase 2 blockers (record them)

Update `docs/decisions/OPEN_QUESTIONS.md`, marking these RESOLVED with today's date. Add `docs/decisions/0001-phase-2-po-decisions.md` that summarizes them.

- **OQ-P-13**: APPROVED. Suiem never integrates Banchor's growth loops (scroll-to-buy, scroll dividends, detox auto-buy, highlight auto-execution, one-tap copy mirroring), including future "opt-in" variants.
- **OQ-P-05**: Login is **email OTP + passkey (WebAuthn)**. No OAuth in Phase 2 (keep an `AuthMethod` extension point). SIWE is allowed **only for linking a wallet**, never as a login method.
- **OQ-P-06**: Single-maintainer mode. Implement the dual-control primitive properly. In local/dev, a second seeded admin can approve. Document the risk in the ADR.
- **OQ-S-01**: Local development only in Phase 2. No cloud deploys. Use Docker Compose for Postgres 16, Redis, Mailpit, anvil and an OTel collector. Secrets come from git-ignored `.env`, read through a `SecretProvider` interface so a cloud secret manager can drop in later.
- **OQ-PR-03**: Use the public testnet RPC for development. The Alchemy testnet endpoint is optional and enabled when `ALCHEMY_API_KEY` is set (viem `fallback([alchemy, public])` per ADR-0002).
- **OQ-PR-05**: Run the ADR-0002 §3 AA verification spike first (read-only: `eth_getCode` for EntryPoint v0.7/v0.8 on 46630, testnet bundler/paymaster availability, P-256/RIP-7212). Record the results in `VERIFIED_FACTS.md`. If AA is not confirmed on testnet, ship **external wallets via SIWE only** and leave a stubbed `SmartAccountProvider` interface.
- **OQ-S-02**: Gas sponsorship / paymaster is OFF in Phase 2.
- **OQ-P-14**: Do NOT install or run Banchor's code. It is not needed.
- Email delivery: an `EmailProvider` interface. Mailpit (SMTP) locally. No real email vendor yet.

If something else blocks you, add it to OPEN_QUESTIONS.md, choose the safest reversible default, and tell me at the end. Do not silently guess on anything financial, privacy-related or security-related.

## Git workflow

1. The repo has no commits yet. First commit the Phase 1 docs as they are: `docs: phase 1 discovery, architecture and ADRs` (include PRD.md, Suiem_PRD.md, docs/, prompts/, .gitignore; reference-banchor/ stays ignored).
2. Create branch `phase-2/platform-foundation` and work there.
3. Make small, focused commits per milestone, using conventional commit messages. Never commit `.env` or secrets. Do not push. There is no remote.

## Scope: build these epics in this order

**M1. Monorepo + tooling (E2.1)**
pnpm workspaces + Turborepo, matching the ARCHITECTURE §9 layout. Create only the packages Phase 2 needs: `apps/web`, `apps/api`, `packages/{config,shared,db,chain,ui}`, `infra/docker-compose.yml`. Use placeholder READMEs for later apps/workers (extension, research, indexer, etc.). Strict TS. ESLint + Prettier. dependency-cruiser enforcing the §9 rules, including "extension must not depend on chain" and "research must not depend on chain write builders". Pin exact versions and commit the lockfile. Use the `onlyBuiltDependencies` allowlist. Node and pnpm versions go in `.nvmrc` / `packageManager`.

**M2. CI (E2.2)**
GitHub Actions workflows (written now, run later): typecheck, lint, dep-cruiser, unit, integration (Testcontainers), `forge build` placeholder for `packages/contracts` (empty Foundry project is OK), Gitleaks, osv-scanner, CodeQL. PR template containing the PRD §24 Definition-of-Done checklist. Also make every check runnable locally through `pnpm` scripts, and run them yourself.

**M3. Database (E2.4)**
`packages/db` with Drizzle + plain SQL migrations. Conventions from ARCHITECTURE §6: UUIDv7, `numeric(78,0)` token amounts plus `decimals`, `numeric(20,6)` fiat with currency, `bytea` addresses + `chain_id`, `book enum('simulated','testnet','live')` with `live` CHECK-blocked. Phase 2 tables only: `users`, `user_auth_methods`, `user_sessions`, `devices`, `wallet_accounts`, `user_preferences`, `profiles` (minimal), `consent_records`, `policy_versions`, `audit_logs`, `idempotency_keys`, `outbox_events`, `feature_flags`, `jurisdiction_policies`, `policy_decisions`, `admin_roles`, `admin_actions`, `dual_control_requests`, `data_requests`. RLS on user-owned tables keyed by `app.user_id`. Append-only triggers on `consent_records`, `audit_logs`, `policy_decisions` and `admin_actions`. Seed script for local dev.

**M4. Shared foundations (`packages/shared`)**
Zod schemas, the API error envelope, a decimal-safe money/amount library with tests (no floats, ever, enforced by a lint rule on money modules), the consent state machine, the WARC event taxonomy (PRD §2.3), and ID utilities. No runtime I/O.

**M5. API skeleton + Auth (E2.3)**
NestJS on Fastify. `/api/v1`, OpenAPI generated from Zod, a structured error envelope, request validation, idempotency-key interceptor for writes, rate limiting (Redis), audit context. Auth: email OTP (hashed, short TTL, attempt-limited) + passkey register/login (WebAuthn, `@simplewebauthn/server`). HttpOnly + Secure + SameSite session cookies, session rotation, CSRF protection. Endpoints: `POST /auth/register`, `/auth/login` (+ OTP and passkey ceremony routes), `/auth/logout`, `GET/PATCH /me`, `GET/POST /me/consents`, `GET /me/data-inventory`, `POST /me/data-requests` (export/delete jobs as skeletons that record status).

**M6. User/profile + onboarding (E2.5, E2.6)**
Preferences, interests (skippable, editable), experience level. Versioned terms and privacy policies. Consent recorded with policy version + timestamp. Consent withdrawal. Data inventory. Web onboarding flow per PRD §5.1 steps 1–9 and 12–13 (the extension offer is a placeholder until Phase 3). **No wallet and no funding is required to finish onboarding.** No token or order code path exists anywhere.

**M7. Wallet abstraction (E2.7)**
`packages/chain`: the chain config for 46630 lives in `packages/config/chains/robinhood-testnet.ts`, and each value cites its `VERIFIED_FACTS` row ID. Every service asserts `eth_chainId === 46630` at boot and refuses to start otherwise. Viem public clients only, with no write builders yet. Wallet linking with SIWE (EIP-4361): server nonce, domain/URI/chainId 46630 binding, expiry, single-use nonce. `POST /wallet/link`, `DELETE /wallet/link/:id`. The web app uses wagmi to connect any EIP-1193 wallet. The custody-model and risk explanation screen comes before linking (PRD §5.1 step 6). Private keys never touch the backend.

**M8. Feature flags + jurisdiction policy (E2.8)**
Server-side flags and policy engine. Every decision is logged with policy version and reason. Flags: `trading.live` (hard-off: no API, admin or DB path can enable it; enforced by a test and a DB CHECK), `trading.simulated`, `elections`, `campaigns`. Jurisdiction default: live trading disabled everywhere. India is research/education/simulation only (PRD §17). Navigation in the web app is flag- and policy-aware, with server enforcement as the source of truth.

**M9. Observability (E2.9)**
OpenTelemetry traces, metrics and logs (Pino) to a local collector. An **allowlist-based redactor**, so no emails, addresses, OTPs, tokens, cookies or page text reach logs. WARC event emission hooks.

**M10. Admin base (E2.10)**
RBAC roles, MFA required for every admin (passkey counts), reason codes, immutable audit log, audit-log search, and a dual-control request/approve primitive. Admin routes live in `apps/web` behind RBAC.

**M11. Design system v0 (E2.11)**
`packages/ui`: tokens (premium calm fintech, dark navy primary plus accessible light mode, restrained green), focus states, reduced motion, status components that do not rely on colour alone, and loading/empty/error/disabled states. Apply it to the onboarding and settings screens. WCAG 2.2 AA contrast.

## Phase 2 acceptance tests (all must be automated and passing)

- A user signs up and logs in with email OTP and with a passkey, without any wallet. Consent is stored with policy version + timestamp.
- No order or token-transfer code path exists. A test or lint rule asserts there are no chain write builders in Phase 2.
- SIWE linking: a wrong chainId, wrong domain, expired message or replayed nonce is rejected.
- `trading.live` cannot be enabled through any API, admin action or SQL update.
- RLS: user A cannot read or modify user B's rows through any repository or endpoint (per-table tests).
- An admin action without MFA or a reason code is rejected and audited. A dual-control action needs a second, distinct admin.
- Append-only tables reject UPDATE/DELETE.
- The redaction test proves that logs contain no email, address, OTP, session or token values.
- The money library has property tests for exact decimal conversion and no float usage.
- CI fails on a committed fake secret, a dep-cruiser violation, and a high-severity vulnerable dependency (demonstrate each, then revert).
- Boot fails when the RPC chainId is not 46630.
- Playwright E2E: onboarding → consent → interests skipped → land on home, with no wallet. Also: link an external wallet (using a test wallet on anvil or a mocked EIP-1193 provider).
- Every UI screen has loading, empty, error and disabled states, plus keyboard navigation (PRD §24).

## Also deliver

- A `.env.example` that lists every variable with a description and no values.
- A root `README.md` with prerequisites and a quickstart (`docker compose up`, `pnpm i`, `pnpm db:migrate`, `pnpm dev`, `pnpm test`).
- `docs/runbooks/local-dev.md`.
- Updated `docs/VERIFIED_FACTS.md` with the AA spike results.
- `docs/PHASE_2_REPORT.md`: what was built, how each acceptance and exit criterion is met (with test names), TM-01/17/18/19 controls with their tests, deviations from the plan, new open questions, and known gaps.

## Hard rules

Do not:
- deploy contracts or send any transaction (anvil local only, for tests)
- use real funds or a private key with value
- add stock trading, orders, tokens, elections or extension features (those are Phases 3–7)
- copy code from reference-banchor
- invent addresses or provider capabilities (cite VERIFIED_FACTS)
- commit secrets
- use floats for money
- weaken a Phase 1 ADR silently. If you must deviate, write a new ADR that supersedes it and explain why

Before reporting completion, run the full local check suite (typecheck, lint, dep-cruiser, unit, integration, E2E) and paste the summary output into PHASE_2_REPORT.md. If something fails, say so plainly. Do not claim it passes.

Finish with:
1. An executive summary
2. An acceptance-criteria checklist (pass/fail, with test names)
3. New risks and open questions
4. A proposed Phase 3 (Suiem Intelligence) kickoff checklist, including what you need from me (data provider, LLM provider, Chrome Web Store account)

Then STOP and wait for my approval before Phase 3.
