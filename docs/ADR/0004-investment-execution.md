# ADR-0004: Investment execution and venue adapters

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §8, §15 (orders), §17, §19.5; **D-04**

## Context

Banchor's `ScrollBasket → MockVenue → MockRouter` mints mock stocks at owner-set prices with `minOut = 0`. Its claim that "on mainnet the same contracts buy the real ones" is false (TECHNICAL_GAP_ANALYSIS §4). On Robinhood Chain mainnet, Stock Tokens are RHJ tokenised debt securities traded on Uniswap, Rialto, Lighter and RFQ venues, with jurisdiction restrictions. No testnet venue and no testnet Stock Token addresses are verified (S-06, T-05). The faucet does hand out test Stock Tokens (T-02).

## Decision

1. **No Suiem trading contract.** Execution is orchestrated off-chain by the Order module through a `VenueAdapter` interface (`quote`, `preview`, `buildCalldata`, `reconcile`). This is Banchor's `IStockVenue` idea moved off-chain, where policy checks can run before signing.
2. **Adapters per phase**
   - `SimulatedVenue`: always on. Ledger fills at a licensed, timestamped quote with a disclosed fee/slippage model. Separate `simulated` book.
   - `TestnetVenue`: built only if a testnet venue for faucet test Stock Tokens is verified. Until then testnet tokens are **holdings-only** (read balances, link to the official faucet).
   - `LiveVenue`: **not built.** `trading.live` flag hard-off, and a DB CHECK blocks the `live` book.
3. **Pre-trade policy (deterministic, server-side):** registry instrument with tradable status, jurisdiction eligibility, per-order/daily limits, balance and allowance, quote freshness (TTL), slippage bound → `minOut`, price-impact cap, `eth_call` simulation, contract allowlist. Every decision is logged with its policy version.
4. **Preview binding:** the preview stores `(instrumentId, side, amount, quoteId, expiry, chainId, to, data, value)` and a hash. `POST /orders` requires `previewId` + idempotency key. The client re-derives the hash and refuses to sign on mismatch. No order data travels in URLs.
5. **Reconciliation:** state machine `previewed → submitted → pending → (partially_filled)* → filled | failed | expired | cancelled`. Transitions come only from receipts or indexer events (testnet) or ledger fills (simulated). Duplicate callbacks are idempotent.
6. **Accounting:** integer base units, decimals from the registry (read onchain), average-cost cost basis v1 (documented). Corporate-action multipliers modelled per ERC-8056 for future live tokens (S-03).
7. **Labels:** `SIMULATED` and `TESTNET TOKEN` badges are mandatory components. Totals are per book.

## Consequences

- Testnet users can practise the full research → preview → confirm flow on simulated instruments, with no onchain trade until a testnet venue is verified.
- Real execution later is a provider and legal integration (new adapter plus legal gates), not a contract upgrade.

## Open items

OQ-P-03 (testnet Stock Token addresses), OQ-PR-04 (testnet venue existence), OQ-PR-01 (quote licence), OQ-P-12 (simulated fee/slippage model), OQ-L-02.
