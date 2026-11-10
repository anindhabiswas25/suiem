# Technical Gap Analysis — Banchor vs Suiem PRD

Date: 2026-11-10. Inputs: `PRD.md` (v1.0, 2,143 lines), `docs/REPO_AUDIT.md`, `docs/VERIFIED_FACTS.md`.

Coverage legend: **●** usable foundation · **◐** partial or pattern only · **○** absent · **✕** present but conflicts with the PRD (must be removed)

## 1. Summary

Banchor covers about 5% of Suiem's scope by capability, and almost none of it in a form Suiem can ship. What it offers is a set of proven patterns (chain event reconstruction, local matching, untrusted-content handling, venue-adapter abstraction). Everything Suiem is distinctive for is absent: consent, research with citations, theses, social, reputation, elections, escrow, jurisdiction gating, observability and admin. Suiem is a **greenfield build that consults Banchor as reference**, not a migration of it. Banchor stays in `reference-banchor/` and is never imported.

## 2. Gap matrix: every PRD section

| PRD § | Requirement area | Banchor | Gap / action | Phase |
| --- | --- | --- | --- | --- |
| 0.1 | Clone and inspect reference | — | Done (`REPO_AUDIT.md`) | 1 |
| 0.2 | Agent rules (no invented addresses, testnet, no auto exec, `.env.example`, tests, decisions log) | ✕ invents "real xStocks" equivalence. Has `.env.example` | Rules adopted as CI-checked policy (secret scan, address allowlist from `VERIFIED_FACTS`) | 1–2 |
| 0.3 | First deliverables | — | This document set | 1 |
| 1 | Five pillars, positioning, principles | ✕ "Your attention span, tokenized" | Full rebuild around research-first | all |
| 2.1 | Goals | ◐ local detection exists | — | 3–7 |
| 2.2 | Non-goals (no auto-buy, no copy trading, no $WIF→score…) | ✕ violates several | DROP list in `REPO_AUDIT.md` §5 | 1 |
| 2.3 | North star WARC | ✕ tx counter | Event taxonomy plus analytics pipeline | 2 (events), 5 (metric) |
| 2.4 | Supporting metrics | ○ | Metrics catalogue in observability | 2, 8 |
| 3 | Personas / JTBD | ○ | Inform UX. Beginner-safe defaults | 3–5 |
| 4.1 | Web IA (14 nav areas, jurisdiction-aware) | ◐ 4 routes, all to be dropped | Next.js app shell with feature-flag/jurisdiction-gated nav | 2 |
| 4.2 | 37 primary objects | ◐ buys, minutes | Domain model (`ARCHITECTURE.md` §6) | 2–7 |
| 5.1 | Onboarding without wallet, consent records | ✕ sign-in *is* wallet creation | Account-first auth. Wallet optional. Consent records with policy version | 2 |
| 5.2 | X discovery flow → research → preview → sign | ✕ highlight → buy | Detection → notification → side panel → research → (optional) web order preview | 3, 4 |
| 5.3 | Daily digest | ○ | Local-first digest, optional sync | 3 |
| 5.4 | Thesis lifecycle with frozen versions | ○ | Append-only `thesis_versions` | 4 |
| 5.5 | Social discovery, read-only follow | ✕ copy basket | Read-only follow | 5 |
| 5.6 | Community election | ○ | ElectionManager + TestWIF + indexer | 7 |
| 5.7 | ON/PAUSED/OFF/PRIVATE gating real scripts | ◐ Start/Stop session, per-site block | State machine gating content-script registration, alarms, fetch | 3 |
| 6.1 | MV3 architecture (SW, content, popup, side panel, options, shared pkg) | ◐ SW, content, popup. No side panel, options or shared pkg | Rebuild with Vite + React + TS (CRXJS or WXT) | 3 |
| 6.2 | Permission minimization | ✕ `<all_urls>`, tabs, idle, social hosts | `activeTab`, `contextMenus`, `sidePanel`, `storage`, `alarms`. Optional per-site host permission | 3 |
| 6.3 | Entity detection with confidence, ambiguity | ◐ exact-match dictionary of 20 | Confidence-scored matcher, context classifier, ambiguity output | 3 |
| 6.4 | Notifications | ✕ buy nudges | Rate-limited research notifications | 3 |
| 6.5 | Research side panel (13 sections, figure provenance) | ○ | Side panel UI plus brief schema | 3–4 |
| 6.6 | Digest controls | ○ | Options page | 3 |
| 6.7 | Extension acceptance criteria | ○ | Playwright extension E2E | 3 |
| 7.1 | Research engine capabilities | ◐ single LLM call | Deterministic workflow (ADR-0006) | 3–4 |
| 7.2 | Source grounding, citations, provenance | ✕ uncited | Retrieval → claims → citation validator | 3–4 |
| 7.3 | Versioned brief schema | ○ | Zod schema in `packages/shared` | 3 |
| 7.4 | AI safety (no signals, injection, no execution) | ◐ injection framing, allowlist. ✕ buy picks | Keep framing. Remove picks. Separate research and execution services | 3 |
| 7.5 | Orchestration | ○ | Deterministic step graph. LangGraph optional | 3 |
| 8.1 | Instrument registry with verified fields | ✕ addresses.json of mocks | `instruments` + `instrument_contracts` with verification timestamps | 4 |
| 8.2 | Research-to-order 12 steps | ✕ intent in URL, minOut 0 | Order service: quote → preview → policy → sign → reconcile | 4 |
| 8.3 | No automation by default | ✕ | Enforced: no session keys, no stored signing authority | 2, 4 |
| 8.4 | Portfolio, cost basis, sim/live separation | ◐ balances × mock price | Ledger with separate simulated/testnet books | 4 |
| 8.5 | Watchlists and alerts | ○ | — | 4 |
| 8.6 | Copy/follow read-only | ✕ copy basket | Read-only | 5 |
| 9.1–9.3 | Feed, post types, interactions | ○ | — | 5 |
| 9.4 | Profile privacy (private by default) | ✕ roast card public by address | Visibility model per field | 5 |
| 9.5 | Moderation | ○ | Reports, queues, appeals | 5 |
| 10.1–10.5 | 50/50 Suiem Score | ○ | Versioned score engine | 6 |
| 11.1–11.4 | $WIF utility and voting | ○ | TestWIF + WIFVoting | 7 |
| 11.5–11.6 | Rewards and campaigns | ○ | CampaignEscrow + workflows | 7 |
| 12.1 | ElectionManager / WIFVoting / CampaignEscrow | ○ | Foundry package | 7 |
| 12.2 | Contract security | ◐ OZ, custom errors, CEI mostly | Timelock, multisig roles, pausable, fuzz/invariant | 7 |
| 12.3 | Accurate event names | ◐ ScrollBuy | `VoteAssetBurned` vs `VoteAssetTransferredToSink` by actual mechanism | 7 |
| 13.1 | Modular monolith | ◐ single process | NestJS modules per domain | 2 |
| 13.2 | Stack | ◐ Next.js, viem, Foundry match | Confirmed with changes (ADR-0009) | 1 |
| 13.3 | Service boundaries | ○ | — | 2–7 |
| 14 | Data model, integer money, append-only | ◐ bigint-as-text pattern. ✕ REAL minutes, float USD | PostgreSQL, `numeric(78,0)` base units, migrations | 2+ |
| 15 | Versioned REST API catalogue | ✕ `/api/*` unauthenticated | `/api/v1` with OpenAPI, auth, idempotency keys | 2+ |
| 16.1 | Threat model | ○ | `ARCHITECTURE.md` §8 | 1 |
| 16.2 | Security requirements | ◐ no keys server-side (good) | Full list (CSP, allowlists, simulation…) | 2, 8 |
| 16.3 | Privacy requirements | ◐ local matching | Data inventory, retention, export/delete | 2–3 |
| 16.4 | User rights | ○ | DSAR export/delete flows | 2–3 |
| 17 | Legal/jurisdiction gating, India gate | ✕ none ("xStocks aren't offered in the US" noted as out of scope) | Server-side eligibility policy. Live trading off | 2, 4 |
| 18.1 | SLOs | ○ | — | 8 |
| 18.2 | Observability | ○ (console.error) | OpenTelemetry | 2 |
| 18.3 | Backups/DR | ○ (SQLite on volume) | Managed Postgres PITR, restore drill | 8 |
| 19.1–19.3 | Unit/integration/contract tests | ◐ 89 tests (36 sol, 53 ts), unexecuted here | Per-package suites in CI | 2+ |
| 19.4 | 16-step E2E | ○ (e2e.ts covers buy loops only) | Playwright + anvil/testnet E2E | 8 |
| 19.5 | Financial correctness tests | ◐ bigint basket math | Decimal library tests, reorg, partial fills | 4, 7 |
| 20 | Design and accessibility | ◐ reduced-motion support in nudges. ✕ casino tone | Design system in `packages/ui` | 2–5 |
| 21 | Monetization, fee disclosure | ○ | Out of scope until legal review | — |
| 22 | Admin console with RBAC/MFA/audit | ○ | Admin base | 2, then each phase |
| 23 | Rollout releases 0–7 | — | Mapped to Phases 1–8 (`IMPLEMENTATION_PLAN.md`) | — |
| 24 | Definition of Done | ○ | PR template and CI gates | 2 |
| 25 | D-01…D-12 | — | ADRs 0001–0009 (`docs/ADR/README.md` traceability) | 1 |
| 26 | First-session instructions | — | Followed | 1 |
| 27 | Reference links | — | Verified in `VERIFIED_FACTS.md` | 1 |
| App. A | Agreed decisions 1–15 | ✕ conflicts with 7, 11, 14 | Enforced in ADR-0001 | 1 |
| App. B | Acceptance summary 1–16 | ○ | Each item mapped to a phase exit (`IMPLEMENTATION_PLAN.md` §3) | 2–8 |

## 3. Reusable patterns (to carry forward, rewritten)

1. **Chain is the source of truth for onchain facts.** The backend never takes the client's word for a transaction (Banchor `indexer.ts`, `confirmIntent`).
2. **Idempotent event store:** unique `(chain_id, tx_hash, log_index)`, with event inserts and cursor advance in one DB transaction.
3. **Range-capped log polling with RPC fallback** (`viem.fallback`), `cacheTime: 0` for head reads, and a multicall probe.
4. **Local-first matching** in the extension against a bundled dictionary, with nothing sent on selection.
5. **Untrusted page content:** a system prompt that declares page text as data, output allowlists, strict length caps, timeouts and spend caps, and an explicit "unavailable" rather than invented output.
6. **Closed Shadow DOM** for injected UI, never interrupting typing, and per-site opt-out.
7. **Per-action signing session** that is wiped in `finally`, with an address-match check.
8. **Venue adapter abstraction**, moved off-chain.
9. **Test style:** exact revert selectors, "nothing stays in the contract" assertions, injectable clocks and fetchers.

## 4. MockVenue/MockRouter limits, and what genuine tokenized-stock execution needs

### 4.1 What Banchor's venue actually is

- `MockRouter.swapExactIn` computes `out = in × 1e18 / ownerPrice` and **mints** a fresh `MockStock`. There is no counterparty, no inventory, no liquidity, no price discovery, no spread, no slippage, no fees, no market hours, no halts, no corporate actions, no settlement and no issuer.
- Prices are typed in by the deployer from an unlicensed endpoint once a day, with no oracle and no staleness check. `minOut = 0` is always passed, so slippage protection is effectively off.
- USDC paid in sits in the router forever, and `MockSellDesk` pays out by minting new MockUSDC in an unbounded loop. The system is not conserved: value is created on both sides.
- The ticker symbols mimic real tokenized-stock tickers (`NVDAx`), so balances look like real holdings.
- Banchor's own Kuru attempt failed for lack of venue cooperation (`backend/README.md` "Kuru"), which shows that "one `setVenue` call to go live" was never true.

### 4.2 What genuine execution would need (mainnet, future, gated)

| Requirement | Robinhood Chain reality (VERIFIED_FACTS) | Suiem dependency |
| --- | --- | --- |
| A legally issued instrument | Stock Tokens are RHJ-issued **tokenised debt securities** with economic exposure only and no shareholder rights (S-01, S-02) | Disclosures must say this verbatim. Never "own shares" |
| Investor eligibility | Not for US persons. Restrictions in CA, UK, CH. India unspecified (S-04) | Legal opinion for India (OQ-L-02), KYC/geo provider, server-side eligibility policy |
| A venue with liquidity | Mainnet: Uniswap AMMs, Rialto propAMM, Lighter, RFQ aggregators (S-06) | Venue adapter per venue. Commercial/API terms. Quote-freshness SLAs |
| Market data and oracles | Chainlink feeds, 24/5 (S-07) | Licensed display data (D-05). Staleness/market-hours guards |
| Pre-trade controls | — | Quote expiry, slippage bounds (`minOut` from live quote), price-impact caps, balance/allowance checks, simulation (`eth_call`), contract allowlist |
| Exact approvals | — | Permit2 (VERIFIED T-10) or exact-amount approvals. Never unlimited |
| Post-trade | Corporate actions via `uiMultiplier()` (S-03) | Reconciliation from receipts plus indexer. Cost basis that handles multipliers |
| Compliance | Sequencer sanctions screening (C-17) is not enough on its own | Sanctions screening at Suiem level, record retention, complaints process |
| Custody model | Self-custody smart account | Clear custody disclosure. Recovery tested |

**Conclusion:** genuine execution is a provider and legal integration project, not a contract swap. It stays **disabled** in all eight phases. The adapter interface and order-preview UX are built and tested against testnet only.

### 4.3 Testnet instrument strategy

Two clearly separated books. They never mix in one total.

1. **"Testnet Stock Tokens" book**, used only if T-05 is resolved. The faucet's test TSLA/AMZN/PLTR/NFLX/AMD tokens (T-02) are registered in the instrument registry with `legal_type = 'testnet_test_token'`, `chain_id = 46630`, address and decimals read onchain, `last_verified_at`, and `source_url`. UI badge on every surface: **"TESTNET TOKEN — no value, not a security, not a share"**. Balances are read from chain. If no testnet venue is verified (S-06), Suiem shows holdings only and offers no testnet trading. Users top up from the official faucet via a link, and Suiem never mints.
2. **"Simulated" book (default and always available).** Off-chain paper instruments keyed to real-world entities (e.g. `SIM:NVDA`), filled at a timestamped quote from the licensed data provider with an explicit simulated fee/slippage model. Stored in a separate ledger (`book = 'simulated'`). UI badge: **"SIMULATED — paper trading, no assets"**. Simulated results never feed the live-verified part of the Investor Performance Score (§10.2). The score shows "simulated" status.

Guard rails for both: instrument symbols carry a `SIM:` or `TEST:` prefix in the UI. Tickers ending in `x` that imitate xStocks are never used. Registry entries without a verified source cannot be created (DB constraint plus admin dual control).

## 5. Migration plan (reference preservation)

The PRD asks to "preserve the reference implementation until replacement modules pass tests". Since nothing is migrated in place:

- `reference-banchor/` stays as a git-ignored, read-only checkout pinned at `565075b`. It is never imported, built in CI or deployed.
- Each ADAPT pattern is reimplemented in Suiem with its own tests. The PR description cites the Banchor file it learned from.
- Banchor's Monad deployment is unaffected. Suiem never interacts with it.
- When Phase 8 exits, `reference-banchor/` may be deleted locally. Its commit hash stays in this audit.
