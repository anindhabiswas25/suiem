You are the staff engineer for Suiem. Sprint 4 (AI research, watchlists, theses) is DONE and APPROVED.

This is **SPRINT 5 of 8: Invest on Testnet**. Budget about 5 hours. This is the world is flat hackathon build, and **submissions close 12 Nov 2026, 17:30 UTC**. Build the thinnest version that works for real. Hardening is deferred (ADR-0010).

**Work in this single session. Do not spawn subagents or fan out parallel agents.**

## Read first

- `docs/HACKATHON_PLAN.md`
- `docs/sprints/SPRINT_4.md` (especially "Sprint 5 prep: OQ-P-03")
- ADR-0004 (investment execution) and ADR-0010
- PRD §5.2 steps 11–15, §8.1–§8.4 (asset model, research-to-order flow, consent, portfolio), §19.5 (financial correctness tests), §20.2 (UX rules)
- `docs/VERIFIED_FACTS.md` (testnet rows: T-05…T-10, Permit2, Multicall)
- migration `0001_foundation.sql` (`instruments`, `orders`, `order_events`, `fills`, `positions`, `ledger_entries`, the `book` enum with `live` blocked, `idempotency_keys`)
- `packages/chain`, `packages/config/src/jurisdictions.ts`, `packages/contracts` (empty Foundry project)

Work on branch `hackathon/main`. Make small conventional commits. Do not push.

## PO decisions for this sprint

- **OQ-H-02:** the jurisdiction comes from a **self-declared country** (onboarding + Settings), checked server-side against J-01 on every Stock Token route. Undeclared or restricted means blocked, with a clear explanation. No IP geolocation.
- **S5-01:** re-read https://docs.robinhood.com/rhj/restricted-jurisdictions and update J-01 and `jurisdictions.ts` if it changed. If the page can't be fetched, keep the current list and log it.
- **Testnet deploys are PRE-APPROVED for this sprint** (testnet 46630 only, no value). **Mainnet is NOT approved**, and nothing in this sprint touches chain 4663.
- Keys: generate a **testnet-only deployer** and a **testnet-only quote signer** locally with `cast wallet new`. Write both private keys to the git-ignored `.env` as `TESTNET_DEPLOYER_PRIVATE_KEY` and `QUOTE_SIGNER_PRIVATE_KEY`, and add their names to `env.ts` / `.env.example`. **Print only their addresses**, never the keys. These keys must never be used on any chain other than 46630; add a chain-ID assertion in the deploy script and the signer.
- If the deployer has no testnet ETH, STOP at the deploy step. Tell me its address so I can fund it from https://faucet.testnet.chain.robinhood.com, then continue when I say so. Do everything else (contracts, tests on anvil, API, UI) first, so the deploy is the last step.

## Three books, never mixed (PRD §8.4)

| Book | What it is | How it trades |
|---|---|---|
| **Simulated** | Paper trading at real Finnhub quotes for any registry company (e.g. NVDA, which has no testnet token) | Offchain fills at the quote, with a disclosed simulated fee/slippage model |
| **Testnet demo** | Suiem demo tokens on 46630 (e.g. "Suiem Demo TSLA", symbol `dTSLA`), bought and sold for `dUSD` through `SuiemDemoVenue` | **Real testnet transactions the user signs**, and the core of the Stock Tokens demo |
| **Testnet faucet holdings** | Robinhood's official test Stock Tokens in the user's linked wallet | **Read-only balances**. Suiem never mints or trades them |

The portfolio shows each book separately, with a persistent label ("Simulated", "Testnet demo · no value", "Testnet test token · no value"), and **never sums them together**. No row may ever claim to be a real share or security.

## Build

### 1. Verify the testnet Stock Tokens (S5-02 / OQ-P-03)

- For each candidate in SPRINT_4.md, read onchain via the testnet RPC: `name()`, `symbol()`, `decimals()`, `totalSupply()`, and the code hash.
- **Confirm the address only by tracing a faucet distribution:** a transfer from the faucet's distributor address to a recipient. Use the explorer API (`/api/v2/addresses/{addr}/token-transfers` or token transfers) and identify the distributor as the sender that hands out several of these tokens to many addresses.
- **If tracing is inconclusive, ask me** to claim faucet tokens to my test wallet and give you the wallet address. The token contracts that arrive in that wallet from the faucet are authoritative.
- Look-alikes ("TSLA Test Stock", "TESLA", lending wrappers) must never be registered.
- Update `VERIFIED_FACTS.md` (T-05/T-06), and set the registry instruments (`TEST:TSLA` etc.) to `active` only once confirmed. Otherwise they stay `unverified`, and the UI hides their balances with a note.

### 2. Contracts (`packages/contracts`, Foundry, Solidity 0.8.x, OpenZeppelin 5 pinned via forge)

- **`DemoUSD` (`dUSD`, 6 decimals):** name "Suiem Demo USD (testnet, no value)". A built-in faucet: `claim()` gives 1,000 dUSD, at most once per address per 24h. The venue is the only other minter. No admin mint beyond that.
- **`DemoStockToken`:** one per symbol (TSLA, AMZN, PLTR, NFLX, AMD), 18 decimals. Name "Suiem Demo `<TICKER>` (testnet, no value)", symbol `d<TICKER>`. Only the venue can mint and burn.
- **`SuiemDemoVenue`:**
  - `buy(Quote q, bytes sig, uint256 minOut)` and `sell(Quote q, bytes sig, uint256 minOut)`.
  - `Quote` is EIP-712 typed data: `{trader, token, side, amountIn, price, feeBps, expiry, nonce}`, with domain `{name: "SuiemDemoVenue", version: "1", chainId, verifyingContract}`.
  - It checks:
    - the signer equals the quote signer
    - `msg.sender == trader`
    - `block.timestamp <= expiry` (expiry at most 60s; **use `block.timestamp`, never `block.number`**, C-18)
    - the nonce is unused (replay protection)
    - the token is listed
    - the output is at least `minOut` (the slippage bound)
  - Buy pulls `dUSD` with `transferFrom` (exact-amount approve, never unlimited, from the UI) and mints demo stock. Sell burns demo stock and mints dUSD.
  - Emits `Trade(trader, token, side, amountIn, amountOut, price, fee, nonce)`.
  - Admin: set the quote signer, list a token, and pause. Ownable2Step. No upgradeability. Holds no user funds beyond collected fees in dUSD.
- **Tests:** unit, fuzz (amounts and decimals rounding toward the user never benefiting from rounding), plus:
  - replayed nonce reverts
  - expired quote reverts at the exact boundary
  - wrong chainId or verifying contract signature reverts
  - wrong trader reverts
  - `minOut` violation reverts
  - paused reverts
  - non-venue mint reverts
  - faucet cooldown
  - an invariant that dUSD in plus fees equals the value of minted demo stock at the signed price
  - Run Slither if available and record the findings.
- **`script/DeployTestnet.s.sol`:** asserts `block.chainid == 46630`, deploys everything, lists the 5 tokens, and writes `packages/contracts/deployments/46630.json` (addresses, tx hashes, block, git SHA, compiler, constructor args). Verify the sources on Blockscout if its API supports it. Generate typed ABIs into `packages/chain` (wagmi CLI or abitype from the Foundry artifacts).

### 3. Order service (`apps/api`, the PRD §13.3 order-service boundary)

- **`VenueAdapter` interface:** `quote`, `preview`, `buildCalldata`, `reconcile`. Implementations: `SimulatedVenue` and `TestnetDemoVenue`. **There is no live adapter**, and `trading.live` stays hard-off.
- **`POST /orders/preview`:**
  - runs the pre-trade checks:
    - flag on
    - jurisdiction eligible
    - instrument resolved from the registry and `active`
    - book matches the instrument
    - amount limits (per order and per day, from env)
    - balance read onchain for testnet
    - venue not paused
  - fetches a Finnhub quote (with timestamp)
  - for testnet, signs an EIP-712 quote (expiry 60s) and builds calldata with viem
  - simulates with `eth_call`
  - returns the preview:
    - instrument identity and legal type label
    - network badge
    - quote price and timestamp
    - amount and estimated quantity
    - fee
    - slippage bound / `minOut`
    - route (`SuiemDemoVenue` address with an explorer link)
    - approval needed (exact amount)
    - risks text
    - a **preview hash** over `(chainId, to, data, value)`
- **`POST /orders`:**
  - requires an `Idempotency-Key`
  - stores the order bound to the preview hash
  - the client must submit exactly that calldata
  - the web app re-encodes from the preview, compares hashes, and shows the decoded call before calling the wallet
  - a tampered amount, recipient or target is rejected (regression test for Banchor R-1)
- **Reconciliation:**
  - the client reports the tx hash
  - **the server** fetches the receipt from the RPC
  - it parses the `Trade` event from the venue address only, and checks trader, nonce and amounts against the order
  - then writes `order_events`, `fills`, `ledger_entries` and `positions`
  - **Positions change only from reconciled fills, never from client claims.**
  - States: `pending → submitted → filled | failed | expired`. A reverted tx means `failed`; an expired quote means `expired`.
  - A duplicate tx report or duplicate event is a no-op (unique constraints).
- **Simulated orders:** a fill at the quote plus the disclosed fee/slippage model, then the same ledger path with `book = simulated`.
- **Other endpoints:** `GET /orders/:id`, `GET /orders/:id/events`, `GET /portfolio` (per book), `GET /portfolio/transactions`, `GET /portfolio/history` (snapshots from fills and quotes), `GET /portfolio/export` (CSV).
- **Faucet holdings:** `GET /portfolio/testnet-holdings` reads the linked wallet's balances of **verified** faucet Stock Tokens via the RPC (Multicall only at a verified address).
- **Cost basis:** average cost, documented on the methodology/help page. Realized and unrealized P&L uses the money library (bigint, no floats). Every value has a price timestamp and source.

### 4. Web app

- **Research page trading section** (replacing the Sprint 4 placeholder): shows only if the instrument is resolved and active, the flags allow it, and the jurisdiction is eligible. Otherwise it explains why. Buttons: "Buy demo token (testnet)" and "Paper trade (simulated)".
- **Order ticket** (quote expires in 60s, re-quote button), then **Order preview** (every field above) **and** a confirmation checkbox ("I understand this is a testnet demo token with no value and not a security"). Then: switch to network 46630 → exact-amount approve if needed → sign the trade in the wallet → status timeline (submitted, then posted/final when available) → receipt with the explorer link.
- **"Get demo dUSD"** button (calls `DemoUSD.claim()` from the user's wallet) and a link to the official faucet for testnet ETH.
- **`/portfolio`:**
  - three separate book sections
  - positions, quantity, average cost, current value with quote time, and P&L with methodology
  - order/transaction history with explorer links
  - CSV export
  - an empty state for each book
- **Settings:** country declaration, plus an explanation of why it is asked.
- **Help:** the three books explained, the restricted-jurisdiction list, and "demo and testnet tokens have no value and are not securities".

## Tests (must pass)

- **Foundry:** all contract tests above.
- **PRD §19.5 financial correctness:** no floats (lint + scan); exact decimal conversion between 6 and 18 decimals; quote expiry; slippage bound; failed tx; duplicate callbacks and duplicate events; reconciliation against chain (anvil); average-cost method; books never summed (test the portfolio API shape).
- **API integration against anvil:** deploy the contracts in a local anvil with chain ID 46630 for tests, then run the full flow: preview → sign → submit → server reconcile → position. Also cover:
  - the preview-hash tamper check
  - the idempotency key
  - jurisdiction blocked (restricted and undeclared)
  - instrument unverified means no ticket
  - `trading.live` still impossible
  - user A can't see B's orders or portfolio
  - a device token gets 403 on all order and portfolio routes
- **Web:** order ticket component tests (expiry countdown, re-quote, confirmation required).
- **Live testnet check (manual, after deploy):** `pnpm invest:smoke`, run with a throwaway test wallet funded from the faucet (not the deployer), does claim dUSD → buy dTSLA → reconcile → sell. Record the tx hashes in the sprint report. **These are our first real onchain transactions for the submission.**
- All existing checks stay green: typecheck, lint, format, depcruise, unit, integration, and the extension E2E.

## Hard rules

- No automatic buying of any kind. Every trade is a user-reviewed, user-signed transaction, and nothing is triggered by detection, research, AI, social activity or votes.
- Content scripts and the research worker have no path to order code (the depcruise rules stay).
- Testnet only. No chain 4663 calls in this sprint.
- Never present demo or test tokens as real shares or securities.
- No unlimited approvals.
- Never print or commit private keys.
- Never use Robinhood's name or logo in token names, the UI or the contracts.

## Deliverables

- `docs/sprints/SPRINT_5.md`: what works and how to see it (manual demo steps), the test output, the deploy manifest summary, the tx hashes, the Slither notes, deviations, and open questions.
- Update `docs/VERIFIED_FACTS.md`, `docs/HACKATHON_PLAN.md` and `packages/contracts/README.md`.

Finish with:
1. What works now
2. Test summary
3. Deployed addresses (testnet)
4. Anything skipped
5. What I need for Sprint 6 (social + reputation)

Then STOP and wait for my approval before Sprint 6.
