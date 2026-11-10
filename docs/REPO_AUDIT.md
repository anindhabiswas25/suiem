# Banchor Reference Repository Audit

| | |
| --- | --- |
| Repository | https://github.com/soumyacodes007/banchor |
| Local copy | `reference-banchor/` (git-ignored, read-only, untrusted) |
| Commit audited | `565075b282c87660757f6c31e8c7a1e16a19facb` ("Merge Arko's scroll sessions", 2026-11-04 +0530) |
| History | 17 commits, 2026-11-03 → 2026-11-04 (hackathon: Monad Blitz, Devcon Mumbai) |
| Size | 83 tracked files, ~7,900 lines excluding lockfiles and images |
| Audit date | 2026-11-10 |
| Method | Every tracked source, config, test, script, doc and the screenshot was read in full. Nothing was installed, built, run or deployed (Phase 1 rule). Tests were **counted and read, not executed** |

## 1. Executive verdict

Banchor is a well-written, honest **hackathon demo** of attention-to-purchase on Monad testnet. Its central loops (scroll dividends, highlight-to-buy, copy basket, detox auto-buy, buy nudges, AI buy picks) are the behaviours the Suiem PRD forbids (§2.2, §5.2, §8.3, Appendix A.7). Its contracts implement a fixed-price mint-on-buy venue that cannot be upgraded into real execution. Its wallet is a passkey-derived **plain EOA**. The README describes a session-key spending cap, but that does not exist in the code.

**Reuse is limited to patterns, not modules:** event-sourced chain reconstruction, idempotent `(tx_hash, log_index)` storage with an atomic cursor, viem fallback transports, untrusted-content prompt framing with output allowlisting, Shadow-DOM content UI, an origin check on external messages, small validated message handlers, and the test style. No Banchor contract, address, extension script or web page moves into Suiem as-is.

## 2. Repository structure

```
banchor/
├── README.md              Pitch, architecture ASCII, deployed Monad addresses
├── docs/PRD.md            "Doomscroll Dividends: Demo PRD (v2)" (396 lines)
├── .gitignore             node_modules, contracts/out|cache|broadcast, .env*, backend/data
├── screenshots/1.png      GitHub "fork this repo" instruction image (not product UI)
├── contracts/             Foundry, solc 0.8.30, OpenZeppelin 5.4.0 via npm (bun.lock)
│   ├── src/ MockUSDC, MockStock, MockRouter, MockSellDesk, ScrollBasket, StockFactory,
│   │        venues/IStockVenue, venues/MockVenue
│   ├── script/ Deploy.s.sol, DeploySellDesk.s.sol
│   └── test/ ScrollBasket.t.sol (25 tests), MockSellDesk.t.sol (11 tests)
├── backend/               Node ≥24, native TS strip-types, node:sqlite, viem 2.57.3 only
│   ├── server.ts api.ts store.ts chain.ts indexer.ts basket.ts roast.ts prices.ts analyze.ts
│   ├── api.test.ts (35 tests) analyze.test.ts (18 tests) e2e.ts (anvil/testnet script)
│   └── addresses.json railway.json .railwayignore
├── extension/             MV3, plain JS, no build step
│   ├── manifest.json background.js highlight.js nudge.js live.js announce.js
│   ├── popup.html popup.js dither.js config.json tickers.json icons/
└── web/                   Next.js ^16.4.5, React ^19.3.1, viem ^2.57.16, @category-labs/mera ^0.3.0, TS ^7.0.2
    ├── app/ page.tsx dashboard/page.tsx roast/[id]/page.tsx live/page.tsx layout.tsx globals.css
    ├── components/ SignIn TopUpModal Brand Dither
    └── lib/ wallet.ts chain.ts config.ts abi.ts api.ts extension.ts addresses.json
```

## 3. Architecture as built

```mermaid
flowchart LR
  subgraph Browser
    EXT[MV3 extension<br/>background.js + content scripts<br/>on all_urls + social sites]
    WEB[Next.js dashboard<br/>Mera passkey → EOA]
  end
  BE[Node backend on Railway<br/>no auth, CORS *<br/>SQLite]
  OR[OpenRouter LLM]
  YF[Yahoo Finance<br/>unofficial endpoint]
  subgraph Monad Testnet 10143
    SB[ScrollBasket] --> MV[MockVenue] --> MR[MockRouter] -->|mint| MS[MockStock ×20]
    SD[MockSellDesk] -->|faucet mint| USDC[MockUSDC]
  end
  EXT -- "?intent=base64 (URL)" --> WEB
  WEB -- DD_BOUGHT txHash --> EXT
  EXT -- minutes, analyze page text --> BE
  BE --> OR
  WEB -- signed tx (user pays MON gas) --> SB
  BE -- getLogs ScrollBuy every 500ms --> SB
  YF -. prices.ts with deployer key .-> MR
```

### 3.1 Dependencies

| Area | Runtime deps | Notes |
| --- | --- | --- |
| contracts | `@openzeppelin/contracts` 5.4.0, `forge-std` (git 620536f) | Installed through npm/bun into `node_modules` (remappings.txt). `fs_permissions` lets scripts write `../backend` |
| backend | `viem` 2.57.3 | Relies on Node 24 built-in TS type stripping and `node:sqlite` (experimental) |
| extension | none | No bundler, no TypeScript, no tests |
| web | next, react, react-dom, viem, `@category-labs/mera` | Caret ranges (non-reproducible). `AGENTS.md` warns about a nonstandard Next.js version |

### 3.2 Chain assumptions (all Monad-specific, all DROP)

- Chain ID 10143 hard-coded in `extension/background.js:9`, `web/lib/config.ts:3` (`viem/chains.monadTestnet`), `addresses.json`.
- RPCs `testnet-rpc.monad.xyz`, `rpc.ankr.com/monad_testnet`, `rpc-testnet.monadinfra.com`. Explorer `testnet.monadvision.com`.
- Monad quirks are baked into the code: gas is billed on the gas limit (explicit `gas:` everywhere), "funds settle a few blocks late", public RPC rejects JSON-RPC batch, Multicall3 at the canonical address.
- `deployBlock` 76867666, with 20 MockStock addresses plus MockUSDC, router, venue, factory, basket and sell desk. **None of this exists on Robinhood Chain.**

### 3.3 Wallet, passkey and the session-key/spending-cap design

| Claimed (README, docs/PRD.md) | Actually implemented (code) |
| --- | --- |
| "Passkey smart account", "no gas", "sponsored gas" | `web/lib/wallet.ts` uses **Mera** (Monad library). It derives a secp256k1 **EOA** private key from the WebAuthn PRF output (`deriveEvmPrivateKey`) and signs locally through `createSecp256k1SigningSession`. No smart account, no paymaster. The user needs test MON for gas (`web/README.md` admits this) |
| "Weekly spending cap set once with Touch ID", "session key scoped to ScrollBasket, max cap per 7 days, 30-day expiry, Revoke" | **Not implemented.** `extension/README.md` "Not done yet" says the session-key signer is pending, and `web/lib/session.ts` does not exist. Every buy needs a passkey prompt in the dashboard tab |
| Key hygiene | Good pattern: `withSigner()` derives the key per action and calls `session.end()` in `finally`. It checks that the derived address matches the saved one |
| Recovery | Passkey is bound to `rpId = location.hostname`. Changing domain loses the account. Only an exported phrase recovers it. PRF works only for some providers |
| Approvals | `approve(basket, 2^255)` and `approve(desk, 2^255)`: **unlimited allowances** (`web/lib/chain.ts:69,88`) |

### 3.4 Contracts: interfaces and events

| Contract | Interface | Events | Notes / defects |
| --- | --- | --- | --- |
| `MockUSDC` | `faucet()` mints 1,000e6 to caller, unlimited, permissionless. 6 decimals | ERC-20 | Infinite free money by design |
| `MockStock` | `mint(to, amt)` only by immutable `router` | ERC-20 | No burn. Name "Mock {SYM}" but symbol is e.g. `NVDAx`, which looks like real xStocks / Stock Token tickers (**impersonation risk**) |
| `MockRouter` | `setPrice(stock, price)` (owner or factory), `swapExactIn(stock, in, minOut, to)` | `PriceSet`, `Swapped` | Owner-set prices; stock minted from nothing; USDC accumulates in router with no withdrawal |
| `IStockVenue` | `buy(stock, usdcIn, minOut, to) → out` | — | Useful *concept* (venue adapter) |
| `MockVenue` | Wraps router. Max-approves router in constructor | — | — |
| `ScrollBasket` (Ownable) | `buy(stock, amt, minOut, Source)`, `buyBasket(stocks[], amts[], minOuts[], Source, ref)`, `buyFor(to, ...)`, `setVenue`, `setDefaultVenue`, `venueOf` | `ScrollBuy(user idx, stock idx, usdc, out, source idx, ref)`, `VenueSet` | `Source {SCROLL, HIGHLIGHT, COPY, GIFT}` encodes forbidden flows onchain. Owner can redirect any stock to an arbitrary venue instantly (no timelock or multisig), and with `minOut = 0` (always passed by web/back-end) a malicious venue could take the user's USDC for nothing. `setDefaultVenue` emits no event. Resets allowance correctly via `forceApprove` |
| `StockFactory` (Ownable) | `create(symbol, price)` deploys MockStock, sets price | `StockCreated` | — |
| `MockSellDesk` | `sell(stock, amt, minUsdc)` | `ScrollSell` | `while (balance < out) usdc.faucet();` is an **unbounded loop that mints**. Gas DoS at high prices. Stocks are never burned |

Deploy script: lists 20 tickers at hard-coded "Nov 3, 2026 closes", reads `DEPLOYER_PRIVATE_KEY` from env (good: not on the CLI), and writes `addresses.json` via `vm.writeJson` (good pattern, but there is no commit hash or verification record).

### 3.5 Mock assets

- 20 `MockStock`s with x-suffixed symbols (METAx, GOOGLx, NFLXx, AMZNx, SPYx, NVDAx, TSLAx, AAPLx, MSFTx, AMDx, COINx, MSTRx, PLTRx, HOODx, INTCx, ORCLx, UBERx, DISx, SHOPx, BABAx).
- Priced from Yahoo Finance's unofficial chart endpoint (`backend/prices.ts`). That endpoint is unlicensed and unsuitable for display (PRD §7.2, D-05), and the run requires the deployer key.
- README/PRD line: "On mainnet, the same contracts would buy the real ones." **This is false.** MockRouter mints, and real tokenized securities need a regulated issuer, venue, eligibility and KYC (see `TECHNICAL_GAP_ANALYSIS.md` §4).

### 3.6 Backend API (`backend/api.ts`)

No authentication, `access-control-allow-origin: *`, no rate limit except on `/api/analyze`. Anyone can write data for any address (the README acknowledges this).

| Endpoint | Behaviour |
| --- | --- |
| `POST /api/minutes` | Replaces weekly scroll minutes per ticker for any address (unauthenticated). Values are stored as SQLite `REAL` |
| `GET /api/basket/:address?mode=roast\|detox` | `buyBasket` args from minutes. `minOuts` always `"0"` |
| `GET /api/copy/:address?usd=` | Args that **mirror another wallet's portfolio** (copy-trade) |
| `GET /api/portfolio/:address` | Onchain balances × router price. Returns float `usd` numbers |
| `GET /api/prices` | Router prices as floats, 15 s cache |
| `GET /api/roast/:address` | Shaming copy derived from browsing time |
| `GET /api/stats` | Vanity transaction counters |
| `POST /api/analyze` | Sends page `{url,title,text≤12k}` to OpenRouter and returns `picks` with **dollar buy amounts** ($1/$5/$20). Cache is keyed by URL **across all users**, so one caller who posts crafted text for a URL poisons the result every other user gets for that URL for 1 h |
| `GET /health` | Indexed block |

**Indexer (`indexer.ts`):** polls `getLogs` for `ScrollBuy` up to the chain tip every 500 ms in 100-block ranges, and stores events and cursor in one SQLite transaction (good). **No confirmation depth, no block-hash/reorg detection, no `finalized` tag, no contract versioning.** A reorg would leave phantom buys.

### 3.7 Extension permissions and privacy behaviour

| Item | Value | PRD verdict |
| --- | --- | --- |
| `permissions` | `tabs, alarms, idle, storage, contextMenus, scripting` | `tabs` + `idle` exist for attention tracking. Violates §6.2 minimization |
| `host_permissions` | Monad RPCs, `*.up.railway.app`, `*.onrender.com`, localhost, **amazon/facebook/instagram/netflix/twitter/x/youtube** | Permanent social-site access for time tracking. Violates §6.2 |
| `optional_host_permissions` | `https://*/*` | Requested at runtime for custom backend/RPC. OK pattern |
| Content scripts | `highlight.js` on **`<all_urls>`** (selection listener on every page). `nudge.js` on social sites (scroll/mouse/key listeners, buy nudges). `live.js` on Instagram/YouTube. `announce.js` on **every `*.vercel.app`** page and localhost, writing the extension ID into the DOM (fingerprinting: any Vercel site can detect the install) | Violates §6.2 and §16.3 |
| `externally_connectable` | `*.vercel.app`, localhost | Origin is checked against the configured dashboard when set (`background.js:677`). With an empty `dashboardUrl`, **any** Vercel app can call `DD_SET_WALLET`/`DD_BOUGHT` |
| ON/OFF | A "session" Start/Stop gates counting, and per-site blocklist and highlight toggles exist. Content scripts still load and attach listeners when stopped. No PAUSE durations, no Private Mode, no incognito handling | Violates §5.7 ("hiding a popup is not sufficient") |
| Data leaving the device | Weekly minutes per ticker to the backend (unauthenticated). Full page text (≤12k chars) on "Analyze". Popup loads Google Fonts (third-party request) | §16.3 issues |
| Buy flow | Intent JSON base64-encoded in the dashboard URL `?intent=` | See §3.8 |
| Matching | `tickers.json`: 20 stocks with aliases such as "Instagram", "Facebook", "YouTube" → stock and **"the market" → SPYx**. `x.com`/`twitter.com` → TSLAx | Product names and plain phrases as tickers produce false buy cards (§6.3, §6.7) |
| Rates UI | "How aggressive? Chill / Normal / Aggressive / **YOLO $1/min**" | Gamified pressure (§20.1) |
| XSS hygiene | `nudge.js`/`popup.js` escape output. `highlight.js:27` interpolates `data.ticker`/`data.company` into `innerHTML` unescaped (values come from bundled JSON, so low risk now, but a latent sink) | Fix in Suiem |

### 3.8 Web app: routes, components, API calls

| Route | Behaviour | Findings |
| --- | --- | --- |
| `/` | Landing "Meta profits from your attention. Take a cut." with Mera sign-in | Messaging conflicts with §1.2 |
| `/dashboard` | Wallet, balances, holdings, activity (localStorage), top-up, and **executes `?intent=`** | **Transaction-substitution bug:** `decodeIntent` checks only shape. The confirm sheet shows `STOCKS[ticker]` and `usd`, but `buyIntent` spends `item.usdc` and calls `item.stock`, neither of which is bound to the displayed values or checked against the address allowlist. A crafted link can show "$5 Nvidia" and spend $1,000 (PRD §16.1 "Transaction substitution", §16.2 "human-readable transaction details") |
| `/roast/[address]` | Roast card and **"Copy this basket"**: auto-top-up, then a `buyBasket(COPY)` mirroring another wallet | Forbidden (§8.6) |
| `/live` | Stage counter polling `/api/stats` | Vanity metric (§2.3) |
| `lib/chain.ts` | Faucet top-up, buy/sell, receipt parsing | Floats via `Number(formatUnits())` for balances (§14). Unlimited approvals. `minOut 0` |
| `lib/extension.ts` | `chrome.runtime.sendMessage` with ID from env, DOM or `?ext=`. ID regex `^[a-p]{32}$` | ID validation is a reusable detail |

### 3.9 Security-relevant summary

| # | Severity (in Suiem context) | Finding | Location |
| --- | --- | --- | --- |
| R-1 | Critical | Displayed amount/asset not bound to executed calldata (URL intent) | `web/app/dashboard/page.tsx` `decodeIntent`/`confirmBuy`, `web/lib/chain.ts` `buyIntent` |
| R-2 | Critical | Claimed spending cap/session key does not exist | `extension/README.md` "Not done yet", `web/README.md` |
| R-3 | High | Unauthenticated, CORS-* write API (`/api/minutes`) | `backend/api.ts` |
| R-4 | High | Cross-user LLM cache poisoning by URL | `backend/analyze.ts` `samePage` cache |
| R-5 | High | AI emits buy picks with dollar amounts, one tap to buy | `backend/analyze.ts`, `extension/popup.js` `ANALYSIS_BUY` |
| R-6 | High | Owner can hot-swap venues with no timelock, and `minOut = 0` everywhere | `ScrollBasket.setVenue`, callers |
| R-7 | High | Indexer has no reorg/finality handling | `backend/indexer.ts` |
| R-8 | Medium | Unlimited ERC-20 approvals | `web/lib/chain.ts` |
| R-9 | Medium | `<all_urls>` content script, extension-ID beacon on all `*.vercel.app` | `manifest.json`, `announce.js` |
| R-10 | Medium | Unbounded mint loop in sell desk | `MockSellDesk.sol:42` |
| R-11 | Low | Unescaped `innerHTML` interpolation | `extension/highlight.js:27` |
| R-12 | Low | Deployer key handled by an ad-hoc price script. Prices from unlicensed endpoint | `backend/prices.ts` |
| R-13 | Info | No secrets found in git history (scan for keys, `sk-or-`, 64-hex). `.env*` ignored | `git log -p --all` |

### 3.10 Test coverage

| Suite | Count | Covers | Gaps |
| --- | --- | --- | --- |
| `contracts/test/ScrollBasket.t.sol` | 25 | Faucet, pricing math, factory/mint auth, source/ref rules, array mismatch, zero amounts, unpriced revert, no residual funds, venue switch/kill switch, owner-only | No fuzz, invariant, reentrancy or malicious-venue tests |
| `contracts/test/MockSellDesk.t.sol` | 11 | Sell math, auth, unlisted tokens, dust, minUsdc | Unbounded-loop gas not tested |
| `backend/api.test.ts` | 35 | Basket math, copy proportions, weekStart, minutes validation, stats dedupe, roast copy, routing | No auth tests (no auth), no reorg tests |
| `backend/analyze.test.ts` | 18 | Output allowlisting, amount snapping, caps, injection framing, cache, rate cap | Cache poisoning not considered |
| `backend/e2e.ts` | script | Full loops against anvil/testnet with plain keys | Not CI. Skips the wallet |
| extension | 0 | — | No tests at all |
| web | 0 | — | No tests at all |

**Execution status:** not run. Running needs `npm install` (viem, OpenZeppelin via npm), which Phase 1 forbids for this untrusted tree. Foundry and Node 24 are present locally, so a sandboxed run can happen in Phase 2 if the product owner wants a baseline.

## 4. Module classification

Legend: **REUSE** = take the code largely as-is. **ADAPT** = keep the idea or pattern and rewrite to Suiem standards. **REPLACE** = the capability is needed but this implementation is not. **DROP** = Suiem does not want this capability (forbidden or irrelevant).

### 4.1 Contracts

| Module | Class | Reason |
| --- | --- | --- |
| `MockUSDC.sol` | ADAPT | Suiem needs a clearly labelled testnet reward/settlement token only if no testnet stablecoin is verified (T-12). Must be named "Suiem Test USD (no value)", with a capped/rate-limited faucet, and never called USDC |
| `MockStock.sol` | DROP | Suiem uses faucet test Stock Tokens (once addresses are verified) or **off-chain simulated instruments** in a separate ledger. No x-suffixed lookalike symbols |
| `MockRouter.sol` | DROP | Mints assets at owner prices, which models no real execution and invites misrepresentation |
| `venues/IStockVenue.sol` | ADAPT | The venue-adapter abstraction moves **off-chain** into the Order service (`VenueAdapter` interface: quote, preview, buildTx, reconcile) |
| `venues/MockVenue.sol` | DROP | Tied to MockRouter |
| `ScrollBasket.sol` | DROP | Its `Source` enum (SCROLL/HIGHLIGHT/COPY/GIFT) encodes forbidden behaviours. It holds venue-switch power without timelock. `buyBasket` for copies is forbidden |
| `StockFactory.sol` | DROP | Lookalike stock issuance |
| `MockSellDesk.sol` | DROP | Unbounded minting loop, meaningless economics |
| `script/Deploy.s.sol` | ADAPT | Keep: env-only key, JSON manifest output. Add: chainId assertion (46630), git SHA, Blockscout verification, no `fs_permissions` outside the package |
| `test/*.t.sol` | ADAPT | Keep: style, selector-exact reverts, "nothing stays in contract" invariants. Add: fuzz, invariant, fork tests |
| `foundry.toml` | ADAPT | Pin solc, add `robinhood_testnet` RPC endpoint from env, remove write to `../backend` |

### 4.2 Backend

| Module | Class | Reason |
| --- | --- | --- |
| `server.ts` | REPLACE | Raw `node:http`, no auth/CSRF/rate limits → NestJS modular monolith (ADR-0009) |
| `api.ts` | REPLACE | Unauthenticated, CORS-*, forbidden endpoints. Keep the ideas: body-size caps, strict address parsing, structured errors |
| `store.ts` (SQLite) | REPLACE | → PostgreSQL with migrations. **Keep the pattern:** PK `(tx_hash, log_index)` with `INSERT … ON CONFLICT DO NOTHING`, events and cursor in one transaction, bigint as text/numeric |
| `chain.ts` | ADAPT | viem `fallback()` transport, multicall-when-available probe, `cacheTime: 0` lesson. Rewrite for 46630 and the verified Multicall (T-08/T-09) |
| `indexer.ts` | ADAPT | Keep range-capped polling and idempotent writes. Add block-hash reorg detection, `safe`/`finalized` tags, per-contract version, backfill/rescan, lag metrics |
| `basket.ts` | DROP | Converts browsing minutes to dollars and mirrors portfolios. **Keep only** the bigint `formatUsd` approach → `packages/shared/money` |
| `roast.ts` | DROP | Shaming copy based on browsing time, "You could own…" framing |
| `prices.ts` | DROP | Unlicensed Yahoo scraping, deployer-key price setting |
| `analyze.ts` | REPLACE | Buy picks with amounts, uncited, shared URL cache. **Keep:** "page text is untrusted data" system framing, strict output allowlisting, timeouts, spend caps, and the explicit "no invented answer" fallback |
| `api.test.ts`, `analyze.test.ts` | ADAPT | Keep injectable `now`/`fetcher` and fake-model test style |
| `e2e.ts` | ADAPT | Keep the "real server against anvil" harness idea for Phase 7 |
| `addresses.json`, `railway.json`, `.railwayignore` | DROP | Monad deploy, hosting-specific |

### 4.3 Extension

| Module | Class | Reason |
| --- | --- | --- |
| `manifest.json` | REPLACE | Remove `tabs`, `idle`, `scripting`-by-default, social host permissions, `<all_urls>` content script, and the `*.vercel.app` external match. Use `activeTab`, `contextMenus`, `storage`, `sidePanel`, `alarms` (digest only), optional host permissions per user-enabled site |
| `background.js` | REPLACE | Built around attention tracking and buy intents. **Keep:** the serialized storage write chain (`writeChain`), clamping of numeric messages, the external-origin check, and the "verify receipt before trusting" idea |
| `highlight.js` | REPLACE | Highlight-to-buy auto card is forbidden. **Keep:** closed Shadow DOM, "never interrupt typing" guard, "Never on this site". Suiem: research is user-invoked (context menu or side panel). Highlight never sends anything automatically (§6.7) |
| `nudge.js` | DROP | Scroll-time buy nudges and the activity pill |
| `live.js` | DROP | Stage-mode scroll counting |
| `announce.js` | DROP | Beacons the extension ID to arbitrary sites |
| `popup.html/js` | REPLACE | YOLO rates, top-up, buy-my-scroll. Suiem popup: ON/PAUSED/OFF/PRIVATE, status, open side panel |
| `tickers.json` | ADAPT | Seed for `packages/shared/entity-dictionary`, rebuilt with canonical IDs, exchange-qualified symbols, ambiguity flags, entity type. Remove product/plain-phrase aliases ("Instagram", "the market") and site→stock mappings |
| `config.json` | DROP | Monad addresses |
| `dither.js`, icons | DROP | Banchor brand |

### 4.4 Web

| Module | Class | Reason |
| --- | --- | --- |
| `lib/wallet.ts` (Mera) | REPLACE | Monad-specific library, EOA-from-PRF, domain lock-in, no smart-account policy. → ERC-4337 smart account (provider per ADR-0002) plus external wallets. **Keep:** per-action key session wiped in `finally`, and the address-match check |
| `lib/chain.ts` | REPLACE | Unlimited approvals, `minOut 0`, floats |
| `lib/config.ts`, `lib/addresses.json` | DROP | Monad |
| `lib/abi.ts` | DROP | ABIs come from Foundry artifacts (`packages/contracts` → typed via wagmi-cli/abitype) |
| `lib/extension.ts` | ADAPT | Keep the ID-format validation. The message protocol is redesigned (no tx hashes from the web to the extension) |
| `lib/api.ts` | REPLACE | Swallows all errors as `null` |
| `app/page.tsx` | REPLACE | Messaging |
| `app/dashboard/page.tsx` | REPLACE | R-1 substitution bug, URL-borne intents |
| `app/roast/[id]` | DROP | Copy basket, roast shaming |
| `app/live` | DROP | Vanity counter |
| `components/TopUpModal.tsx` | ADAPT | Concept only: guide users to the official Robinhood testnet faucet. No in-app minting of "dollars" |
| `components/SignIn.tsx` | REPLACE | Tied to Mera |
| `Brand`, `Dither`, `globals.css` | DROP | Banchor brand (PRD §20.1 has its own direction) |

### 4.5 Docs and other

| Item | Class | Reason |
| --- | --- | --- |
| `README.md` | DROP | Inaccurate claims (smart account, cap, "same contracts buy real ones") |
| `docs/PRD.md` | DROP | Requirements superseded. Useful only as the record of what *not* to build. Its Kuru notes confirm that real venue integration needs venue cooperation (consistent with ADR-0004) |
| `backend/README.md` "Things that will bite you on Monad" | ADAPT | Good habit: keep a `docs/runbooks/chain-quirks.md` for Robinhood Chain (e.g. `block.number` semantics, C-18) |
| `.gitignore` | ADAPT | Merged into Suiem `.gitignore` |
| `screenshots/1.png` | DROP | Not product UI |

## 5. Forbidden-behaviour register

Each item is DROP or REPLACE, and the replacement is listed.

| Banchor behaviour | PRD clause | Suiem replacement |
| --- | --- | --- |
| Scroll dividends (minutes → $ → buy) | §2.2, §8.3, App. A.7 | None. Time is never an input to any money flow |
| Highlight-to-buy card | §5.2, §6.3, §6.7 | User-invoked "Research this" (context menu/side panel). Buy only after instrument resolution plus order preview in the web app |
| Detox auto-buys SPYx | §8.3 | None |
| Buy nudges while scrolling | §6.4, §20.1 | Research notification only, rate-limited, never shows a buy |
| One-tap copy-basket mirroring, referral `ref` | §5.5, §8.6 | Read-only portfolio follow and "save portfolio" |
| AI buy picks with dollar amounts | §7.4 | Cited research brief, no buy/sell signal |
| Gift buys (`buyFor`) | not in scope | DROP (no gifting of securities) |
| Weekly cap + session-key silent buys | §8.3 future-only | Not in default product. Any future automation needs a separate ADR plus legal |
| Roast shaming copy | §20.1 | None |
| Live tx counter | §2.3 | WARC metric dashboard (admin) |
