You are the staff engineer for Suiem. Phase 1 (discovery, architecture, ADRs) is done and approved.

## The product owner has changed direction (read carefully)

We are entering the **world is flat hackathon** (https://worldisflat.fun/build/rules). **Submissions close 12 Nov 2026, 17:30 UTC.** Edits lock then, and the app must stay live and working until the final closes (16 Nov 17:30 UTC).

The goal is the **whole Suiem product flow working end to end, as a real working demo**: extension → AI research → thesis/watchlist → testnet Stock Token order → social → 50/50 reputation → $WIF election on mainnet → results.

**Deferred until after the hackathon:** production hardening. That means external audits, legal sign-off, pen tests, load tests, enterprise admin (dual control), cloud secret managers, full RLS coverage and multi-provider failover. Keep the Phase 1 architecture (module boundaries, schemas, viem, the money library), but build the thinnest version of each piece that works for real.

### Hackathon rules that are now requirements

1. The project must use **$WIF onchain on Robinhood Chain**, with **real transactions**. $WIF exists only on **mainnet (chain 4663)**.
2. It needs a **flywheel** that keeps bringing people back to $WIF. Judges look for "a real reason to use $wif, a flywheel that holds up, and something that works and is built well".
3. Proof required: a repo (public, or invite GitHub `wifonrh`), a demo video, and real transactions.
4. Names, logos and copy must **not use Robinhood's name or logo**, and must follow https://docs.robinhood.com/chain/brand-guidelines. Add the organiser's disclaimer style: "not affiliated with Robinhood Markets, Inc."
5. Stock Token features must respect Robinhood's restricted list: US, Canada, UK and Switzerland, plus Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar and Venezuela (https://docs.robinhood.com/rhj/restricted-jurisdictions).

### $WIF facts from the organiser's live API (`GET https://worldisflat.fun/build/api/vote-window`, read 2026-11-10)

- chain_id `4663` (mainnet), $WIF token `0x5173b8ea6923c2d40267890d45c46a3480954773`, decimals `18`
- The hackathon's own vote contract is `0xd1b711917a405782da2ec650a0ee4711a76a5535`. It uses `vote(uint256,uint256,uint256)`, emits `Voted(address,uint256,uint256)`, and 1 $WIF = 1 vote, burned.

Add these to `docs/VERIFIED_FACTS.md` with source "organiser API" and status `VERIFIED (organiser source)`. Before Sprint 7 we will check onchain (`eth_getCode`, Blockscout ABI) whether the token exposes `burn`/`burnFrom`, and how the organiser's contract burns. Do not do that onchain check now. Just log it as a Sprint 7 task.

## Two-network architecture (new ADR)

| Feature | Network |
|---|---|
| $WIF elections, burn-to-vote, optional $WIF tips to research authors | **Mainnet 4663**, real $WIF |
| Optional USDG reward pool for election winners (stretch) | Mainnet, small and prefunded |
| Stock Token buy flow | **Testnet 46630** (faucet Stock Tokens if their addresses are verified, otherwise a clearly labelled Suiem demo venue and demo tokens) plus a simulated book |
| Extension, research, theses, social, reputation | Off-chain (Postgres). Nothing private onchain |

Every onchain action in the UI shows a network badge ("Mainnet · real $WIF" vs "Testnet · no value"). The reputation score is never affected by $WIF votes or holdings.

**The flywheel to document:** users research and publish theses → the community votes on weekly "Research Contributor" and "Investor" elections by burning $WIF → winners get a profile spotlight, plus a prefunded USDG prize if available → more research and more votes. Reputation stays independent.

## The 8 sprints (write these into docs/HACKATHON_PLAN.md)

Times are rough targets in UTC. Each sprint ends with a commit, a short `docs/sprints/SPRINT_N.md` report, and a STOP for my approval.

1. **Discovery.** DONE (Phase 1).
2. **Foundation + app shell (this sprint, about 5h).** Monorepo, DB schema for the whole demo, auth, wallet on both networks, app shell with every route, design system, deploy-ready.
3. **Suiem Intelligence extension (about 6h).** WXT MV3, ON/PAUSED/OFF/PRIVATE that truly gate work, local entity detection, dismissible notification, side panel, user-invoked research, local daily digest.
4. **AI research + registry + watchlist + thesis (about 6h).** Entity/instrument registry seed, research pipeline (Claude API, structured brief schema with citations, real retrieved sources only), research page, watchlists, thesis create/version/publish.
5. **Invest on testnet (about 5h).** Portfolio, order preview (quote time, fees, slippage, network), user-signed testnet buy, reconciliation from the receipt, simulated book kept separate.
6. **Social + reputation (about 6h).** Feed, profiles with privacy, follow, publish, comments, helpful votes, the 50/50 Suiem Score v1 with a "Building track record" maturity state, leaderboard, methodology page.
7. **$WIF economy on mainnet (about 7h).** `SuiemElections` contract (burn-to-vote, holds no tokens, no upgradeability), tests on an anvil fork of 4663, indexer, elections UI with an irreversible-burn review screen, results. **Mainnet deploy only after I approve in that sprint.** Optional USDG prize escrow.
8. **Ship + submit (about 6h, finishing before 12 Nov 15:00 UTC).** Hosted deploy, Playwright golden-path E2E across the whole flow, seed demo data, demo video script, README, submission text, list of real transactions, uptime check until 16 Nov.

Then write `docs/ADR/0010-hackathon-scope-and-two-networks.md`. It supersedes the testnet-only parts of ADR-0001/0002/0005 and records the mainnet exception: real $WIF value is at risk, so the contract must hold no funds, keep minimal code and be fork-tested. Update `docs/decisions/OPEN_QUESTIONS.md` with the PO decisions below.

## PO decisions for this sprint

- Auth: **passkey (WebAuthn) + Sign-In With Ethereum** (SIWE, EIP-4361, accepted on chain 4663 or 46630). No email (it would need a mail vendor for the hosted demo). Judges have wallets anyway, since they vote. Basic research works after login without any funded wallet.
- Banchor growth loops are never integrated (OQ-P-13 approved). No auto-buy of any kind.
- Hosting target (deploy happens in Sprint 8, but stay deploy-ready from now): **Vercel** for `apps/web`, **Railway** (or similar) for `apps/api` + Postgres + Redis. Keep config 12-factor through env vars. Do not deploy in this sprint.
- RPC: public endpoints for both networks, with Alchemy optional via env.
- No gas sponsorship. External wallets (MetaMask, Rabby, Robinhood Wallet, any EIP-1193) through wagmi. No smart accounts for the hackathon.
- AI: Claude API (latest model, ID configurable via env), behind a `ResearchModel` interface.

## Sprint 2 scope: build now

Read first: `PRD.md` (§5, §13–§15, §20), `docs/ARCHITECTURE.md` §6–§9, ADR-0002, ADR-0003, ADR-0009, and `docs/VERIFIED_FACTS.md`. Do not re-audit `reference-banchor/`, and do not copy code from it.

**Git:** the repo has no commits. First commit the Phase 1 docs (`docs: phase 1 discovery and architecture`). Then create branch `hackathon/main` and make small conventional commits. Never commit `.env`. Do not push.

1. **Monorepo:** pnpm + Turborepo, matching the ARCHITECTURE §9 layout. Create `apps/web` (Next.js App Router, TS strict), `apps/api` (NestJS + Fastify, `/api/v1`, Zod validation, OpenAPI), `packages/{config,shared,db,chain,ui}`, and empty-but-wired `apps/extension`, `workers/research`, `workers/indexer`, `packages/contracts` (Foundry init). Exact version pins, committed lockfile. Lint, typecheck and Vitest wired through turbo. A simple dependency-cruiser rule set: extension must not import chain write code, and research must not import chain write code.
2. **Local infra:** `infra/docker-compose.yml` with Postgres 16, Redis, and anvil (one instance forking 4663 and one forking 46630, on separate ports, used in tests only).
3. **Chain config** (`packages/config/chains/`): `robinhoodMainnet` (4663) and `robinhoodTestnet` (46630) as viem chains, each value citing its `VERIFIED_FACTS` row. A `networks` map that tags each feature with its network (table above). Chain-ID assertion helper. A `$WIF` constant only on mainnet, from the organiser fact row.
4. **DB schema for the whole demo** (Drizzle + SQL migrations, so later sprints just add rows):
   - users, auth_methods (passkey, siwe), sessions, wallet_accounts (address + chain_id), preferences/interests, consent_records (policy version + timestamp)
   - entities, entity_aliases, instruments (with `network`, `legal_type` incl. `simulated` / `testnet_test_token`, contract address, decimals, status)
   - research_briefs (JSON brief + schema version + model + prompt version), brief_sources, watchlists, watchlist_items, theses, thesis_versions (append-only)
   - orders, order_events, fills, positions, ledger_entries, with a `book` enum (`simulated`, `testnet`; `live` CHECK-blocked)
   - profiles (per-field visibility), follows, posts, comments, reactions, bookmarks
   - reputation_evidence, reputation_snapshots
   - elections, election_candidates, chain_events (indexed, unique on chain_id + tx_hash + log_index), election_tallies
   - audit_logs, idempotency_keys
   - Conventions: UUIDv7, `numeric(78,0)` token amounts plus decimals, `numeric(20,6)` fiat with currency, never floats. Seed script: demo users, ~30 entities with aliases, instruments for the 5 testnet Stock Token names marked `UNVERIFIED address` until Sprint 5.
5. **`packages/shared`:** Zod schemas (API envelope, research brief v1 per PRD §7.3, extension messages), a decimal-safe money/amount library with tests, ID utils.
6. **Auth (API + web):** WebAuthn register/login (`@simplewebauthn`). SIWE login and wallet linking with server nonce, domain, chainId (4663/46630), expiry and single-use nonce. HttpOnly SameSite session cookie, CSRF token on writes, basic rate limiting. `GET/PATCH /me`, `GET/POST /me/consents`.
7. **Web app shell:** wagmi + viem with both chains and a network switcher. A network badge component. Onboarding per PRD §5.1: purpose, terms/privacy consent, optional wallet with a custody explanation, interests (skippable), experience level, extension offer (placeholder). Every PRD §4.1 nav route exists as a page with a proper empty state: Home, Discover, Research, Watchlist, Portfolio, Feed, Communities, Leaderboard, Elections, Campaigns, Profile, Notifications, Settings (privacy + data export/delete stubs), Help & disclosures (risk text, "not affiliated with Robinhood Markets, Inc.", $WIF "no promise of value or return", testnet "no value").
8. **Design system v0** (`packages/ui`): premium calm fintech, dark navy default plus light mode, restrained green, accessible contrast, status that never relies on colour alone, reduced-motion support, loading/empty/error states. A Suiem wordmark (no Robinhood marks).
9. **Feature flags (simple):** env + DB table. `trading.live` is hard-off (a test asserts it). Plus `trading.testnet`, `elections`, `campaigns`. A server-side jurisdiction check stub using the restricted list above for Stock Token routes.

## Sprint 2 done when (automated where possible)

- `docker compose up && pnpm i && pnpm db:migrate && pnpm db:seed && pnpm dev` runs web + API locally from a clean clone (documented in README).
- A user can log in with SIWE (on either chain) or with a passkey, accept consent (stored with policy version + timestamp), finish onboarding without a funded wallet, and see every nav route.
- SIWE rejects a wrong chain, wrong domain, an expired message or a replayed nonce (tests).
- The money library has passing unit/property tests. No floats in money code.
- `trading.live` cannot be enabled (test). Writes require CSRF and session (test).
- Typecheck, lint, unit and integration tests all pass. Paste the output summary into `docs/sprints/SPRINT_2.md`.
- `.env.example` lists every variable with a description and no values.

## Hard rules (unchanged by the hackathon)

Do not:
- send any mainnet or testnet transaction, or deploy any contract, in this sprint
- add automatic buying of any kind
- invent addresses (use VERIFIED_FACTS only)
- commit secrets
- use floats for money
- put private data onchain
- present test or demo assets as real securities
- use Robinhood's name or logo in branding

If a decision is blocking, choose the fastest reversible option, log it in OPEN_QUESTIONS.md, and tell me.

Finish with:
1. What works now (with how to see it)
2. Test summary
3. Anything you skipped
4. What I must prepare for Sprints 3–8: an Anthropic API key, a financial/news data API key (suggest free options and SEC EDGAR), Vercel and Railway accounts, a mainnet wallet with a little ETH on Robinhood Chain plus some $WIF for test votes, and testnet ETH from the faucet

Then STOP and wait for my approval before Sprint 3.
