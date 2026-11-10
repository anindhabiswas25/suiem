# Suiem Implementation Plan

Date: 2026-11-10 · Status: Proposed (Phase 1 deliverable)
Target: **Robinhood Chain testnet 46630 only, in every phase.** No mainnet, no real funds, no real securities. Live trading stays disabled through Phase 8 (PRD §17, ADR-0004).

Each phase ends with a product-owner approval gate. A phase may not start while a question marked as blocking it in `decisions/OPEN_QUESTIONS.md` is open, unless the phase plan says how it works around that question.

Mapping to PRD §23 releases: Phase 1 = Release 0, Phase 2 = R1, Phase 3 = R2, Phase 4 = R3, Phase 5 = R4, Phase 6 = R5, Phase 7 = R6, Phase 8 = R7 (controlled **testnet** beta only. Public mainnet launch is out of scope).

Every epic inherits PRD §24 Definition of Done: acceptance criteria; loading/empty/success/error/disabled states; authz checks; validation; privacy treatment; unit + integration tests; E2E when user-critical; sensitive-data-free logs and metrics; accessibility review; docs; error recovery; proportional security review; feature flag + rollback; PO acceptance. Financial and onchain work adds: decimal safety, idempotency, simulation, explicit confirmation, reconciliation, contract tests, deployment manifest and security review.

---

## Phase 1 — Discovery, reference audit and architecture

**Epics**
1. E1.1 Repo bootstrap: `git init`, `.gitignore`, PRD copy.
2. E1.2 Banchor clone and full read-only audit (`REPO_AUDIT.md`).
3. E1.3 Chain and $WIF verification (`VERIFIED_FACTS.md`).
4. E1.4 Gap analysis against every PRD section (`TECHNICAL_GAP_ANALYSIS.md`).
5. E1.5 Architecture, trust boundaries, threat model (`ARCHITECTURE.md`).
6. E1.6 ADRs 0001–0009 covering D-01…D-12 (`ADR/README.md`).
7. E1.7 Open-questions register (`decisions/OPEN_QUESTIONS.md`).

**Dependencies:** none.
**Acceptance criteria:** all deliverables listed in the Phase 1 brief exist. Every D-xx is traceable to an ADR. Every chain/token fact has value, source, date and status. No product code. `reference-banchor/` is unmodified.
**Exit criteria (PRD R0):** PO approves the architecture and ADRs. Blocking questions for Phase 2 are answered (OQ-P-05, OQ-P-06, OQ-S-01) or explicitly deferred. No unresolved critical assumption is hidden in code (there is no code).

---

## Phase 2 — Platform foundation

**Epics**
1. E2.1 Monorepo: pnpm + Turborepo, `packages/config` (tsconfig, eslint, prettier), dependency-cruiser boundary rules (ARCHITECTURE §9).
2. E2.2 CI: typecheck, lint, unit, integration (Testcontainers), Foundry build, Gitleaks, osv-scanner, CodeQL. Exact pins. PR template with the DoD checklist.
3. E2.3 Auth (`identity & access`): email OTP + passkey (WebAuthn) login, sessions (HttpOnly/SameSite), CSRF, rate limits, admin MFA. `/auth/*`, `GET/PATCH /me`.
4. E2.4 DB: Postgres 16, Drizzle migrations, conventions (UUIDv7, `numeric(78,0)`, `bytea` addresses, `book` enum), RLS baseline, append-only triggers, `audit_logs`, `idempotency_keys`, `outbox_events`.
5. E2.5 User/profile model, preferences, interests, experience level (§5.1 steps 7–9).
6. E2.6 Consent and privacy service: versioned policies, `consent_records` (policy version + timestamp), consent withdrawal, data inventory endpoint, export/delete job skeleton (§16.3–16.4).
7. E2.7 Wallet abstraction: `packages/chain` (viem clients for 46630 from `packages/config`, chain-ID assertion), `wallet_accounts` linking via SIWE (EIP-4361) for external wallets, smart-account provider spike behind an interface (ADR-0002). No funding is needed to use the product.
8. E2.8 Feature flags + jurisdiction policy engine (server-side, policy-versioned decisions logged). Flags `trading.live` (hard-off), `trading.simulated`, `elections`, `campaigns`.
9. E2.9 Observability: OpenTelemetry traces, metrics and logs with a redaction allowlist. Event taxonomy for WARC (§2.3).
10. E2.10 Admin base: RBAC roles, MFA enforcement, reason codes, audit-log search, dual-control primitive.
11. E2.11 Design system v0 in `packages/ui`: tokens (dark navy + light), focus states, reduced motion, status components that don't rely on colour alone.

**Dependencies:** Phase 1 approval. OQ-P-05 (auth methods), OQ-S-01 (hosting/secrets).
**Acceptance criteria**
- User signs up and logs in without a wallet. Consent recorded with policy version and timestamp (§5.1 AC).
- No order or token transaction is possible from onboarding (there is no code path).
- Linking an external wallet requires a SIWE signature bound to chain 46630 and a server nonce. Replaying the nonce fails.
- `trading.live` cannot be enabled by any API/admin path (test asserts it).
- RLS test: user A cannot read user B's rows through any repository.
- Admin action without MFA or reason code is rejected and audited.
- CI blocks on a committed secret, a forbidden import, or a vulnerable dependency at high severity.
- Logs contain no emails, addresses or tokens (redaction test).

**Exit criteria (PRD R1):** secure account foundation, migration strategy, baseline tests green in CI, `.env.example` complete, and threat-model items TM-01, TM-17, TM-18 and TM-19 have controls with tests.

---

## Phase 3 — Suiem Intelligence (extension + research v1)

**Epics**
1. E3.1 WXT MV3 scaffold: service worker, popup, side panel, options. Permissions `storage`, `activeTab`, `contextMenus`, `sidePanel`, `alarms` (digest only), and per-site **optional** host permissions. Strict CSP, no remote code or fonts.
2. E3.2 State machine ON / PAUSED(30m, 1h, until tomorrow, custom) / OFF / PRIVATE (tab, site, session). Content scripts are dynamically **registered/unregistered** (`chrome.scripting.registerContentScripts`) and alarms are cleared on PAUSED/OFF. Network calls are gated centrally.
3. E3.3 Entity dictionary (`packages/shared`): canonical IDs, aliases, tickers/cashtags, exchange-qualified symbols, entity type (company/product/fund/index/crypto), ambiguity flags. Seeded from a licensed reference list. Banchor's `tickers.json` is a negative example only.
4. E3.4 Local detection: matcher + context classifier with confidence scores. Low confidence stays silent or shows "possible match". Output follows §6.3.
5. E3.5 Notifications: small, dismissible, rate-limited per entity and domain, mute entity/site/category. None while OFF/PAUSED/PRIVATE.
6. E3.6 User-invoked research: context menu "Research selected company". The side panel shows exactly what will be shared before sending. `POST /extension/research-context`. Device registration (`/extension/installations`) with a device-bound token.
7. E3.7 Research engine v1 (`workers/research`): deterministic pipeline, resolve → retrieve (licensed provider adapter, D-05) → normalize → generate (model-agnostic, D-07) → claim/source validation → brief schema v1 (§7.3) with model, prompt and provider versions. Prompt-injection test corpus.
8. E3.8 Research side panel UI: 13 sections (§6.5). Every figure carries currency, period, source, as-of date, reported/estimated/calculated status and formula. Missing data is stated.
9. E3.9 Daily digest: local-only by default, optional sync after explicit opt-in. Categories per §5.3. Delete item or all. Independent toggle. Delivery time and timezone.
10. E3.10 Extension data export/delete. `DELETE /extension/activity`. Uninstall leaves the account intact.

**Dependencies:** Phase 2 (auth, consent, flags, observability). OQ-PR-01 (financial data provider), OQ-PR-02 (LLM provider terms), OQ-L-03 (browser-tracking law review).
**Acceptance criteria (PRD §6.7 and §5.7)**
- With OFF or PAUSED, an automated test observes zero content-script executions, zero alarms and zero network requests from the extension during scripted browsing.
- PRIVATE MODE context produces no history or digest entries.
- An ordinary word or ambiguous ticker ("Apple pie", "$ON", "Meta-analysis", "the market") produces no assertive notification and never any buy UI.
- Notification appears at most once per entity per configured window, is non-blocking, and dismissing it records no intent.
- Highlighting text sends nothing. A research request always shows the context to be shared first.
- No content script can reach an order, transaction or wallet API (no code path, plus lint rule).
- Permission revocation takes effect immediately (test).
- Brief validation rejects any claim without a retrieved source. Injected instructions in page text do not change the output schema or add tool calls.
- Unit, integration and Playwright extension E2E cover every state transition.

**Exit criteria (PRD R2):** privacy-tested extension and research journey complete. E2E steps 2–9 of §19.4 pass. Data export/delete verified.

---

## Phase 4 — Research and investing foundation

**Epics**
1. E4.1 Entity/instrument registry (`entities`, `entity_aliases`, `instruments`, `instrument_contracts`, `market_venues`) with every §8.1 field. Dual-control admin. Onchain `name/symbol/decimals/code` verification job. `legal_type` includes `simulated`, `testnet_test_token`, `unsupported`.
2. E4.2 Market data adapters: quotes with timestamps, freshness, failover, market hours. Licensed display rules (D-05).
3. E4.3 Research workspace: compare companies (`/research/compare`), follow-up questions, feedback/corrections, saved briefs.
4. E4.4 Watchlists and alerts: price, news and thesis-invalidation alerts, quiet hours, no default spam.
5. E4.5 Thesis lifecycle: direction, horizon, rationale, evidence, counterarguments, risks, invalidation conditions. Append-only versions with price context. Private/followers/public. Review flow (§5.4).
6. E4.6 Simulated portfolio: separate `simulated` book, ledger entries, positions, cost basis (documented method), realized/unrealized P&L, timestamped quotes, simulated fee/slippage model, export.
7. E4.7 Testnet Stock Token holdings (only if T-05 resolves): read-only balances from chain for registry-verified faucet tokens. Badge "TESTNET TOKEN — no value, not a security". Link to the official faucet. No in-app minting.
8. E4.8 Order service with adapter interface (`VenueAdapter`: quote, preview, buildCalldata, reconcile). Implementations: `SimulatedVenue` (active) and `TestnetVenue` (only if a testnet venue is verified, S-06). The live adapter is not built. Pre-trade checks: eligibility, instrument status, limits, balance, quote expiry, slippage bound, `eth_call` simulation. Preview hash binds calldata. Idempotent `POST /orders`.
9. E4.9 Order states and reconciliation: pending, partially filled, filled, failed, expired, cancelled. Receipts. Portfolio updates only from reconciled fills.

**Dependencies:** Phase 3 (briefs, entities). OQ-P-03 (testnet Stock Token addresses), OQ-PR-01 (market data licence), OQ-L-01/02 (jurisdiction policy content).
**Acceptance criteria**
- A company mention never resolves straight to a token address. Only registry instruments are tradable (test).
- Buy/sell UI is hidden unless the instrument is resolved, its status is tradable, the flag is on and the jurisdiction policy allows it (server-enforced, with a client-hiding test *and* an API-rejection test).
- Order preview shows instrument identity, token/security details, quote timestamp, amount, estimated quantity, fees, spread/slippage, route and risks (§5.2 step 12).
- Tampering with a preview amount or target between preview and sign is detected and the request rejected (regression test for Banchor R-1).
- §19.5 suite: no floats, exact decimal conversion, quote expiry, slippage bounds, partial fills, duplicate callbacks, failed tx, reconciliation, cost-basis method, simulated/live separation.
- Simulated and testnet positions are never summed into one total. Each carries a persistent label.
- Thesis versions are immutable. Scoring uses the frozen original.

**Exit criteria (PRD R3):** correct, tested research and portfolio accounting. Live trading still disabled with all gates failing closed. Appendix B items 6, 8, 9 and 10 (simulated/testnet only) demonstrable.

---

## Phase 5 — Social network

**Epics**
1. E5.1 Profiles with per-field privacy (§9.4), private by default for financial details.
2. E5.2 Follows, mute/block.
3. E5.3 Publishing: post types (§9.2), labels for sourced, AI-assisted, sponsored and author-verified. Nothing public by default.
4. E5.4 Comments, replies, reactions (helpful/not-helpful, rate-limited), bookmarks, share, report.
5. E5.5 Feed: following, research discovery, trending, community highlights, education, campaigns, election results. Ranking by relevance, quality, freshness and diversity. Paid placement labelled.
6. E5.6 Communities and memberships.
7. E5.7 Moderation: spam/scam/impersonation/manipulation/undisclosed-sponsorship/harassment/fraud reports, queues, actions, appeals, audit trail. AI-content labels.
8. E5.8 Portfolio visibility: read-only public allocation snapshots (consented), thesis-change feed, "save portfolio". **No copy execution.**

**Dependencies:** Phase 4 (theses, portfolios). OQ-L-04 (content/financial-promotion review).
**Acceptance criteria**
- A new user's portfolio, positions, transactions, follower list and leaderboard appearance are private until explicitly enabled (test per field).
- Following a portfolio can never create an order (no API path). "Save portfolio" creates a watchlist only.
- Helpful votes are rate-limited, and suspicious patterns are flagged in tests with synthetic rings.
- Reports reach a moderation queue with SLA metrics. Appeals work.
- Accessibility review passes for feed, profile and composer.

**Exit criteria (PRD R4):** safe social publishing, moderation and privacy. §19.4 steps 10–11 pass.

---

## Phase 6 — Reputation (50/50 Suiem Score)

**Epics**
1. E6.1 Methodology v1 document (published): Investor (40/30/20/10) and Contribution (40/30/20/10), normalization to 0–100, return method (TWR, labelled), benchmark disclosure, minimum history and decisions (D-09).
2. E6.2 Evidence ingestion: reconciled fills, frozen thesis evaluations, research quality signals, peer feedback with diversity weighting. Append-only `reputation_evidence`.
3. E6.3 Score engine (`workers/reputation`): versioned, deterministic, reproducible from evidence. Snapshots and component breakdowns.
4. E6.4 Maturity thresholds: "Building track record" state. Simulated vs testnet status shown.
5. E6.5 Anti-manipulation: Sybil/collusion heuristics, anomaly detection, penalties for copied content and engagement rings.
6. E6.6 Appeals and corrections with an audited recalculation.
7. E6.7 Leaderboards (opt-in only), with methodology and maturity context on every display.

**Dependencies:** Phases 4–5. OQ-P-07 (minimum history numbers), OQ-L-05 (score-as-rating legal review).
**Acceptance criteria**
- Recomputing all scores from evidence for a methodology version yields byte-identical snapshots (reproducibility test).
- $WIF holdings or votes, post counts, AI report counts and browsing time have zero effect on score (property tests).
- A single lucky trade cannot produce a ranked profile (threshold test).
- Simulated results are never labelled live-verified.
- Score display always includes breakdown, maturity, period and methodology version.

**Exit criteria (PRD R5):** reproducible scores, clear methodology, anti-manipulation tests green. §19.4 step 12 passes.

---

## Phase 7 — $WIF economy on testnet

**Epics**
1. E7.1 `packages/contracts`: `TestWIF` (clearly named "Suiem Test WIF — no value", symbol `tWIF`, ERC-20 + ERC20Burnable, capped faucet). `ElectionManager`. `WIFVoting` (mechanism per ADR-0005: true `burn` with `VoteAssetBurned`, or sink transfer with `VoteAssetTransferredToSink`, fixed immutably per deployment). `CampaignEscrow` with a labelled test stablecoin or a verified testnet stablecoin.
2. E7.2 Contract security: AccessControl least privilege, Safe multisig for admin roles, timelock for material config, pausable, no upgradeability (or transparent, documented, timelocked if required), `block.timestamp` windows (C-18), EIP-712 domains with chainId.
3. E7.3 Tests: unit, fuzz, invariant (Σvotes = Σburned or sunk, no double vote, escrow conservation), boundary timestamps, reentrancy, access control, pause, fork tests against 46630 state.
4. E7.4 Deployment manifests `deployments/46630.json` (address, tx, block, git SHA, compiler, constructor args, Blockscout verification link). Deploys run from a testnet-only deployer with a hardware or KMS key and no secrets in the repo. **Deploys happen only with PO approval at the time.**
5. E7.5 Indexer: reorg-safe ingestion (parent-hash continuity, rollback), soft/safe/final states, dedupe, contract-version tracking, backfill and full rescan, genesis-change detection (testnet reset), lag metrics.
6. E7.6 Elections UI: create (authorized creators), configure, moderation checks, nominations, candidate evidence, vote review screen (exact amount, fee, irreversibility, election, candidate, destination contract), results after finality, disputes and invalidation.
7. E7.7 Campaigns: create, fund (prefunded escrow), tasks/evidence, submissions, review with reasons, claims, refunds, final report.

**Dependencies:** Phase 6 (eligibility uses verified accounts, not score). OQ-P-01/02 (official $WIF facts and mechanic, needed only to mirror semantics; the testnet build can proceed with TestWIF), OQ-P-04 (voting rules D-03), OQ-S-03 (multisig signers), OQ-L-06 (reward legal treatment).
**Acceptance criteria**
- An event named `VoteAssetBurned` is emitted only when `totalSupply` decreases by the vote amount (test). Otherwise `VoteAssetTransferredToSink` names the sink.
- Double vote and replay attempts revert. Votes outside the window revert at exact boundary timestamps.
- The indexer survives a simulated reorg on anvil (results roll back and re-apply) and a duplicate log delivery.
- Election results finalize only after all vote events reach `final`, and are reproducible from chain alone.
- The escrow cannot pay more than deposited. Duplicate claims revert. Refunds work on cancel/expiry.
- Every token or contract address in the UI comes from the deployment manifest or `VERIFIED_FACTS`. An unknown-token warning test passes.

**Exit criteria (PRD R6, testnet):** contracts reviewed (internal plus Slither/Aderyn; external audit is a mainnet prerequisite and out of scope), correct burn/sink semantics, reproducible onchain results. §19.4 steps 13–16 pass on testnet.

---

## Phase 8 — Testnet hardening and controlled public beta

**Epics**
1. E8.1 Security review: internal threat-model validation of TM-01…TM-22 with evidence. Third-party penetration test of web, API and extension (if budget is approved). Contract review findings closed.
2. E8.2 Load tests against proposed SLOs (§18.1). Queue and indexer lag under load.
3. E8.3 Full E2E suite (§19.4 steps 1–16) in CI against anvil and a nightly run against testnet.
4. E8.4 Backup/restore drill (PITR), indexer full rescan drill, key-rotation drill, RPC failover drill.
5. E8.5 Runbooks: incident response, extension rollback, provider outage, testnet reset, moderation escalation, data-deletion requests.
6. E8.6 Accessibility audit (WCAG 2.2 AA target).
7. E8.7 Controlled testnet beta: allowlist cohort, feedback loop, kill switches per feature flag, support process.

**Dependencies:** Phases 2–7. OQ-L-07 (beta terms), OQ-S-04 (pen-test budget).
**Acceptance criteria:** all §19.4 steps automated and green. SLO targets met in load test. Restore drill within the agreed RPO/RTO. Every TM item has a passing control test or an accepted-risk record. Every Appendix B item 1–16 is demonstrable on testnet (live trading items shown as simulated/testnet).
**Exit criteria (PRD R7, testnet scope):** product, security, reliability and support owners sign off on the testnet beta. Mainnet launch, real trading and real $WIF integration require a separate approval and a new plan.

---

## Appendix B traceability

| App. B item | Delivered in |
| --- | --- |
| 1 Account without funded wallet | P2 |
| 2 Install and control extension | P3 |
| 3 Browse normally with OFF/Private | P3 |
| 4 Detect a company on X without auto-trade | P3 |
| 5 Sourced AI research on demand | P3 |
| 6 Save brief, create thesis | P3/P4 |
| 7 Digest from opted-in activity | P3 |
| 8 Watchlist | P4 |
| 9 Simulated portfolio | P4 |
| 10 User-confirmed order via verified venue | P4 (simulated, plus testnet only if a venue is verified) |
| 11 Publish research with visibility | P5 |
| 12 Follow investors, public snapshots | P5 |
| 13 Explainable 50/50 score | P6 |
| 14 Verifiable $WIF election (TestWIF on testnet) | P7 |
| 15 Results and prefunded reward status | P7 |
| 16 Export/delete data, revoke permissions | P2/P3 |
