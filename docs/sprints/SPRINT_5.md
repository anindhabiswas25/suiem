# Sprint 5: Invest on testnet

- Date: 2026-11-11 · Branch: `hackathon/main` · Brief: `prompts/PHASE_5_PROMPT.md`
- Status: **built and tested on a local anvil (chain 46630). The real testnet deploy is waiting for faucet ETH on the deployer** (see "Deploy"). Nothing pushed. No chain 4663 transactions.

## What works and how to see it

### Manual demo (local, after the testnet deploy)

```bash
pnpm contracts:deps && pnpm contracts:deploy:testnet   # writes packages/contracts/deployments/46630.json
pnpm db:migrate && pnpm db:seed                         # DEMO:* instruments become active from the manifest
FLAG_TRADING_TESTNET=true pnpm dev
```

1. **Settings:** declare your country. The page explains why it is asked; restricted or undeclared countries are blocked server-side from every Stock Token route. Link a wallet (SIWE).
2. **Research → Tesla:** the **Trading** card lists `TEST:TSLA` (official faucet token, read-only), `DEMO:TSLA` (Suiem demo token) and `SIM:TSLA`.
   - **Get demo dUSD** calls `DemoUSD.claim()` from your wallet. There is also a link to the official faucet for testnet ETH.
3. **Buy demo token (testnet):** enter a dUSD amount, then **Get quote**. The preview shows:
   - instrument and legal-type label, network badge
   - price with time and source
   - amount and estimated quantity
   - fee, `minOut` slippage bound
   - route (SuiemDemoVenue + explorer link)
   - exact-amount approval
   - simulation result, pre-trade checks and risks
   - a **55-second countdown** with **Re-quote**
   - the decoded call your wallet will sign
4. Tick **"I understand this is a testnet demo token with no value and not a security"**, then **Confirm and sign in wallet**. The wallet switches to 46630, then the steps run: exact approve → order confirmed (Idempotency-Key) → sign trade → submitted → **reconciled by Suiem from the chain** → receipt with explorer link.
5. **Paper trade (simulated)** on any registry company (e.g. NVIDIA) fills at the Finnhub quote with the disclosed 0.10% fee and 0.05% slippage.
6. **Portfolio** shows three separate books (Testnet demo · no value, Simulated, Testnet test token · no value) and never adds them together. It has:
   - average cost, value at a timestamped quote, unrealized and realized P&L, methodology
   - history snapshots
   - order history with explorer links
   - CSV export
7. **Help** explains the three books, the restricted-jurisdiction list and that demo/test tokens have no value and are not securities.

## Built

| Brief § | Delivered |
| --- | --- |
| S5-01 | RHJ restricted-jurisdictions page re-read 2026-11-11: **unchanged** (US, CA, GB, CH + 11 Prohibited Investor countries). `jurisdictions.ts` unchanged. |
| 1 Verify faucet tokens (S5-02/OQ-P-03) | **Verified by onchain trace.** The testnet contract labelled "Faucet" (`0x8762…17Be`, `sendTokensAndEther`) mints 5 of each of exactly the five candidates to each claimant in one transaction (26 distinct recipients on the latest page). Read onchain: `name`, `symbol`, `decimals` (18) and `totalSupply`; all five share one code hash. Look-alikes never appear in faucet transactions. Registry `TEST:*` are now `active` with addresses (VERIFIED_FACTS T-05/T-06). |
| 2 Contracts | `DemoUSD`, `DemoStockToken` ×5 and `SuiemDemoVenue` (EIP-712 quotes, nonce, 60 s max expiry on `block.timestamp`, `minOut`, pause, Ownable2Step, no upgradeability) with OZ v5.6.1. Deploy script asserts 46630 and writes the manifest. Typed ABIs are generated into `packages/chain/src/abi/demo.ts`. Testnet-only write builders (`packages/chain/src/write`): calldata, exact approve, claim, `signQuote` (chain-ID assert), preview hash. |
| 3 Order service | `VenueAdapter` with `SimulatedVenue` and `TestnetDemoVenue`. There is no live adapter (`book` never accepts `live`; `trading.live` is hard-off in the DB).<br>• **Preview** runs the pre-trade checks (flag, jurisdiction, active registry instrument, book, per-order/per-day limits, onchain balance, venue not paused), takes a Finnhub quote, signs an EIP-712 quote, encodes calldata with viem, runs an `eth_call` simulation and returns the **preview hash** over `(chainId, to, data, value)`.<br>• **`POST /orders`** needs an `Idempotency-Key` and the preview hash plus acknowledgement.<br>• **`POST /orders/:id/transactions`:** the server fetches the tx and receipt, checks the sender and the binding hash, and parses `Trade` only from the venue address (trader, nonce, side, amount). It then writes fills, ledger entries and positions in one DB transaction.<br>• **Positions change only from reconciled fills.** States: previewed → pending → submitted → filled \| failed \| expired. Duplicates hit unique constraints and are no-ops.<br>• Endpoints: `GET /orders/:id[/events]`, `/portfolio`, `/portfolio/transactions`, `/portfolio/history`, `/portfolio/export` (CSV), `/portfolio/testnet-holdings`, `/invest/status`. |
| 4 Web | Trading section on research pages (with the reason when unavailable), order ticket and preview, Get demo dUSD, `/portfolio` (three books), Settings country explanation, Help. The client recomputes the preview hash from the exact calldata and decodes the call (trader, token, amount, target, network) before the wallet is asked to sign. |

## Test output (2026-11-11)

```text
$ pnpm typecheck                Tasks: 10 successful, 10 total
$ pnpm lint                     eslint . --max-warnings=0 (0 problems)
$ pnpm format:check             All matched files use Prettier code style!
$ pnpm depcruise                ✔ no dependency violations found (238 modules, 680 dependencies cruised)
$ pnpm test (unit)              Test Files 17 passed (17) · Tests 197 passed (197)
$ pnpm test:integration         Test Files 6 passed (6) · Tests 108 passed (108)
$ pnpm test:e2e:extension       10 passed (48.0s)
$ pnpm contracts:test           22 passed (VenueTest) + 1 invariant (128,000 calls, 0 reverts): 23 total
```

| Brief requirement | Where |
| --- | --- |
| Foundry: all listed cases, fuzz rounding, invariant | `packages/contracts/test/SuiemDemoVenue.t.sol` |
| No floats | ESLint money rules extended to `apps/api/src/orders/math.ts`; no `parseFloat`/`parseInt`/`toFixed` in order code or write builders |
| Exact 6 ↔ 18 decimal conversion, average cost, slippage, rounding parity with the contract | `apps/api/src/orders/math.test.ts` (same vectors as Foundry) |
| Full flow on anvil (46630): preview → approve → confirm → sign → server reconcile → position, then sell with realized P&L | `apps/api/test/orders.int.test.ts` (17 tests; deploys the real contracts with the real deploy script) |
| Preview-hash tamper (amount, target, sender; Banchor R-1) | int `› tampered transactions are rejected` + web `verify.test.ts` (6 tamper cases) |
| Idempotency key; quote expiry; failed (reverted) tx; duplicate reports/events | int tests: `Idempotency-Key…`, `an expired quote…`, `a reverted transaction…`, `buy → … duplicate reports are no-ops` |
| Jurisdiction blocked (restricted + undeclared); unverified instrument gets no ticket; `trading.live` impossible | int `› gates and scoping` |
| Books never summed | int `› paper buy … books are never summed` (strict response shape) |
| User A can't see B's orders/portfolio; device token 403 on all 10 order/portfolio routes | int `› gates and scoping` |
| Order ticket: countdown, re-quote, confirmation required | `apps/web/components/invest/TicketView.test.tsx` (react-dom/server) |

## Security review follow-ups (fixed this sprint)

1. **Daily-limit bypass:** a preview already carries a signed quote, so unexpired previews now count toward the daily limit (preview is also covered by the per-user write rate limit). Test added.
2. **Tx-hash squatting:** a hash is stored only once the tx is visible and bound to that order's preview; otherwise a retryable 409. Test added.

Found by tests: fills in the same block second could replay out of order ("sell exceeds position"). Fixed by ordering ties by the time-ordered fill ID.

## Slither 0.11.3 (100 detectors, 28 contracts incl. OZ, 5 results, all accepted)

| Finding | Assessment |
| --- | --- |
| `divide-before-multiply` in `previewOut` (sell fee on rounded-down gross) | Intended: rounding favours the venue; proven by the sell-rounding fuzz test |
| `reentrancy-events` in `buy` and `sell` (event after external calls) | External calls go only to our own demo tokens (OZ ERC20, no hooks). The nonce is marked used before any call. No state is read after the calls |
| `timestamp` in `DemoUSD.claim` and `SuiemDemoVenue._check` | Required by design: `block.number` is unreliable on Arbitrum chains (C-18); quote windows are 60 s |

## Deploy

**Pending:** the testnet deployer `0x8A11E80CAacFE2E9182D7A1Ce64A10E1678BD4C8` has 0 testnet ETH. The quote signer is `0x4553D60f534afc9547848036B273a50c48914182`. After funding: `pnpm contracts:deploy:testnet`, then `pnpm db:seed`, then `pnpm invest:smoke` with the throwaway smoke wallet `0x53bE736A177127dc9BC564539f1BF9a44900F32a` (also funded from the faucet).

## Deviations and decisions

| Item | What and why |
| --- | --- |
| Quote TTL 55 s | The contract allows at most 60 s past `block.timestamp`. Chain time can trail the server clock by a few seconds, so the server signs 55 s quotes and simulates against the `pending` block. |
| Jurisdiction gate | Applied to Stock Token routes (testnet demo book, faucet holdings). **Paper trading (simulated) is available everywhere**, because it involves no Stock Token. |
| Preview stores an order row | A preview creates an order in `previewed` (expires with the quote) so confirmation, tx binding and limits all key off one server record. |
| Faucet holdings | Read with individual `balanceOf` calls (≤ 5 per wallet), not Multicall. |
| Valuation of testnet book | dUSD positions are valued at the real Finnhub quote to make the demo meaningful, and labelled "no value". |
| Chain writes allowed | Only in `packages/chain/src/write/**`, `apps/web/components/invest/**`, `scripts/deploy-testnet.ts` and `scripts/invest-smoke.ts` (scanner test + ESLint). |
| Two keys printed by mistake | While generating the testnet keys, `cast wallet new` wrote to stderr and two freshly generated keys appeared in the session log. Both were **discarded** (never funded, never used, never written to `.env`); new keys were generated silently. Addresses of the discarded keys: `0x3675BE3643e337988CF9af7FE44BD4FAA5411158`, `0x80246beFeC5Ffc84B61104Ae91362CD42294b828`. |
| API boot check | The API still checks `eth_chainId` on both configured RPCs at boot (Sprint 2). That is a read, not a transaction; nothing in this sprint sends anything to 4663. |

## Open questions

- **OQ-H-11:** should the demo venue also accept the official faucet test Stock Tokens (e.g. sell `TEST:TSLA` for dUSD)? Today they are read-only by design.
- **OQ-H-12:** Blockscout source verification for the venue. The deploy script tries it; record the result after the deploy.
