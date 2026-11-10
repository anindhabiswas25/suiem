You are the staff engineer and technical architect for Suiem, an AI-powered social investing and research network. We are building the whole product from scratch, targeting Robinhood Chain TESTNET only. No mainnet, no real funds, and no real securities in any phase.

This is PHASE 1 of 8: Discovery, Reference Audit and Architecture. It is read-only discovery and documentation. Do NOT implement product features in this phase.

## Context

- The working directory is /home/asus/Project/suiem. It currently holds only `Suiem_PRD.md`, which is the product source of truth. It is not a git repository yet.
- Read `Suiem_PRD.md` completely, all 2,143 lines, before doing anything else. Where the PRD says `PRD.md`, it means this file. Copy it to `PRD.md` at the root and keep both.
- Run `git init`. Add a `.gitignore` that covers node_modules, .env*, build output, Foundry `out/` and `cache/`, and `reference-banchor/`.

## The 8-phase roadmap (record it in docs/IMPLEMENTATION_PLAN.md)

1. Discovery, reference audit and architecture (this phase)
2. Platform foundation: monorepo, CI, auth, DB migrations, wallet abstraction, consent/privacy service, feature flags, observability, admin base
3. Suiem Intelligence: MV3 extension with ON/PAUSED/OFF/PRIVATE, local entity detection, notifications, side panel, daily digest, export/delete
4. Research and investing foundation: entity/instrument registry, data adapters, cited AI research engine, research workspace, watchlists, thesis lifecycle, simulated portfolio, testnet order flow behind gates
5. Social network: feed, profiles, follows, publishing, comments/feedback, communities, moderation, portfolio visibility
6. Reputation: 50/50 Suiem Score, evidence ingestion, maturity thresholds, snapshots, appeals, leaderboards
7. $WIF economy on testnet: ElectionManager, WIFVoting, CampaignEscrow (Foundry), event indexer with reorg handling, elections UI, campaigns
8. Testnet hardening and public beta: security review, threat-model validation, load tests, E2E suite (PRD §19.4), backup/restore drill, runbooks, controlled testnet beta

In IMPLEMENTATION_PLAN.md, give each phase its epics, dependencies, acceptance criteria and exit criteria, taken from the PRD.

## Phase 1 tasks

1. Clone the reference repo into `reference-banchor/`:
   `git clone https://github.com/soumyacodes007/banchor.git reference-banchor`
   Treat it as untrusted, read-only reference material. Do not run `npm install`, its scripts, or deployments in this phase.
2. Inspect the full tree: README.md, docs/PRD.md, backend/ (including README, addresses.json, indexer, roast engine, basket planner), contracts/ (ScrollBasket, MockUSDC, MockRouter, MockVenue, StockFactory, tests, scripts, foundry.toml), extension/ (manifest, service worker, content scripts, popup, local name/ticker list), web/ (routes, components, hooks, the Mera passkey wallet integration, API calls), screenshots/, .gitignore, and anything security-related.
3. Document the exact architecture, dependencies, chain assumptions (Monad testnet 10143), the passkey smart account and session-key/spending-cap design, contract interfaces and events, mock assets, API endpoints, extension permissions and privacy behaviour, and test coverage.
4. Classify every module as REUSE, ADAPT, REPLACE or DROP, with a reason. Mark behaviour that the Suiem PRD forbids as DROP or REPLACE. That includes scroll-to-buy, scroll dividends, highlight-to-buy auto-execution, detox auto-buys, one-tap copy-basket mirroring, and passive attention → purchase.
5. Verify the chain facts against official docs (https://docs.robinhood.com/chain/). Initial research gave these leads, which you must CONFIRM, not assume:
   - Robinhood Chain testnet chain ID 46630 (mainnet 4663), an Arbitrum Orbit chain
   - RPC https://rpc.testnet.chain.robinhood.com, explorer explorer.testnet.chain.robinhood.com, gas token ETH
   - Faucet faucet.testnet.chain.robinhood.com, reportedly with test ETH and test Stock Tokens (TSLA, AMZN, PLTR, NFLX, AMD)
   - Still unknown: testnet Stock Token contract addresses, account-abstraction/passkey/paymaster support, finality model, and whether any testnet trading venue exists
   Record verified values with source URLs and the date. Leave anything unverified marked UNVERIFIED. Never invent addresses.
6. Verify $WIF. Initial research suggests "World is Flat / World is Fair" $WIF is a memecoin on Robinhood Chain MAINNET, launched on Pons v2 with a fixed 1B supply. Its voting reportedly works by sending $WIF to a candidate's deposit address, and collected tokens are reportedly destroyed after the event. Several different token addresses use the WIF name on Robinhood Chain, including a bridged "Bitstamp WIF". That is a phishing and impersonation risk, so do not pick one. Document what you can verify. Propose a testnet strategy: a clearly labelled `TestWIF`/mock token that mirrors the verified mechanic, with the burn vs transfer-to-sink semantics stated precisely. Flag the official contract address as a product-owner confirmation item.
7. Explain the limits of Banchor's MockVenue/MockRouter and what genuine tokenized-stock execution would need. For testnet, propose how Suiem uses the faucet Stock Tokens (if verified) or clearly labelled simulated instruments, so they are never presented as real shares.
8. Compare the repo against every PRD section (0–25 plus appendices) in a gap matrix.
9. Propose the Suiem monorepo layout, e.g. apps/web, apps/extension, apps/api, packages/contracts, packages/shared (schemas, entity dictionary), packages/ui, packages/config, workers/*, docs/. Confirm or adjust the PRD §13.2 stack (Next.js, MV3 + React, NestJS, PostgreSQL, Redis/BullMQ, Foundry, viem, OpenTelemetry) with a justification. Pick one of viem and ethers.

## Deliverables

- docs/REPO_AUDIT.md
- docs/TECHNICAL_GAP_ANALYSIS.md
- docs/ARCHITECTURE.md, with mermaid diagrams for system context, components, data flows (extension → research → watchlist/thesis → order preview → signed tx → indexer), trust boundaries and the threat model (PRD §16.1)
- docs/IMPLEMENTATION_PLAN.md (the 8 phases above, in full detail)
- docs/ADR/0001-product-boundaries.md
- docs/ADR/0002-chain-and-wallet.md
- docs/ADR/0003-data-and-privacy.md
- docs/ADR/0004-investment-execution.md
- docs/ADR/0005-reputation-and-voting.md
- docs/ADR/ for the remaining open decisions D-01…D-12 (PRD §25). One ADR per decision is fine, or reference them from the five ADRs above, but every D-xx must be traceable.
- docs/decisions/OPEN_QUESTIONS.md: every unknown that needs product-owner, provider, legal or security confirmation, each with an owner type and whether it blocks a phase
- docs/VERIFIED_FACTS.md: each chain and token fact, with value, source URL, date checked and status (VERIFIED or UNVERIFIED)

## Hard rules for this phase

Do not:
- deploy contracts, send transactions, or use any private key or real funds
- write app/product source code (scaffolding comes in Phase 2)
- modify reference-banchor/
- claim mock or testnet assets are real securities
- invent addresses, RPCs, token details or provider capabilities
- commit secrets
- design any automatic stock buying

Do not claim the audit is complete unless you actually cloned and read the source.

Finish with:
1. A concise executive summary
2. The top 10 risks and assumptions
3. A list of blocking questions for me, the product owner
4. A proposed Phase 2 scope with acceptance criteria

Then STOP and wait for my approval before Phase 2.
