# Verified Facts — Robinhood Chain and $WIF

**Date checked:** 2026-11-10 (all rows)
**Scope change (2026-11-10, PO):** the World is Flat hackathon adds **mainnet 4663** for $WIF only (ADR-0010). Testnet 46630 stays the network for Stock Tokens.
**Rule:** A value is `VERIFIED` only if it was read on a primary source (Robinhood/Robinhood Chain official docs, Robinhood newsroom/support, or the Arbitrum/Offchain Labs official blog). Anything from third-party sites, hackathon repos, aggregators or search snippets is `UNVERIFIED` no matter how often it repeats. Code and config must read these values from `packages/config` with this file as the review source. Never hard-code a value marked `UNVERIFIED`.

Abbreviations for sources:

| Key | URL |
| --- | --- |
| RC-CONNECT | https://docs.robinhood.com/chain/connecting |
| RC-ROOT | https://docs.robinhood.com/chain/ |
| RC-WALLET | https://docs.robinhood.com/chain/add-network-to-wallet |
| RC-FINALITY | https://docs.robinhood.com/chain/transaction-finality |
| RC-DIFF | https://docs.robinhood.com/chain/differences-from-ethereum |
| RC-NODE | https://docs.robinhood.com/chain/run-a-full-node |
| RC-BRIDGE | https://docs.robinhood.com/chain/bridging |
| RC-GAS | https://docs.robinhood.com/chain/gas-and-fees |
| RC-AA | https://docs.robinhood.com/chain/account-abstraction |
| RC-ORACLE | https://docs.robinhood.com/chain/oracles-and-price-feeds |
| RC-PROTO | https://docs.robinhood.com/chain/protocol-contracts |
| RC-CONTRACTS | https://docs.robinhood.com/chain/contracts |
| RC-STOCK | https://docs.robinhood.com/chain/stock-tokens |
| RC-BUILD | https://docs.robinhood.com/chain/building-with-stock-tokens |
| RH-SUPPORT | https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/ |
| RH-NEWS | https://robinhood.com/newsroom/robinhood-chain-launches-public-testnet/ (dated 2026-02-10) |
| ARB-BLOG | https://blog.arbitrum.io/robinhood-chain-testnet/ (dated 2026-02-11) |

---

## 1. Robinhood Chain: network

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| C-01 | Testnet network name | Robinhood Chain Testnet | RC-CONNECT | VERIFIED |
| C-02 | Testnet chain ID | `46630` | RC-CONNECT, RC-WALLET, RC-AA | VERIFIED |
| C-03 | Mainnet chain ID | `4663` | RC-CONNECT, RH-SUPPORT | VERIFIED |
| C-04 | Mainnet status | Live ("Robinhood Chain is live.") | RC-ROOT | VERIFIED. **Suiem still targets testnet only.** |
| C-05 | Mainnet launch date | Not stated on primary pages. A 3rd-party post says 2026-07-01 | — | UNVERIFIED (not needed for testnet) |
| C-06 | Testnet launch date | 2026-02-10 | RH-NEWS | VERIFIED |
| C-07 | Testnet public RPC | `https://rpc.testnet.chain.robinhood.com` (docs: "not recommended for production") | RC-CONNECT, RC-WALLET | VERIFIED |
| C-08 | Testnet provider RPC | `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}`, WS `wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}`. Alchemy is the "recommended infrastructure provider" | RC-CONNECT | VERIFIED |
| C-09 | Other testnet RPC providers | dRPC (`https://drpc.org/chainlist/robinhood-testnet-rpc`) is listed. Pinax is listed but its network label is unclear | RC-CONNECT | VERIFIED for dRPC listing. Pinax testnet endpoint UNVERIFIED |
| C-10 | Testnet explorer | `https://explorer.testnet.chain.robinhood.com` (Blockscout) | RC-CONNECT, ARB-BLOG | VERIFIED |
| C-11 | Mainnet explorer | `https://robinhoodchain.blockscout.com` | RC-CONNECT, RH-SUPPORT | VERIFIED |
| C-12 | Gas token | ETH (both networks) | RC-CONNECT, RC-GAS | VERIFIED |
| C-13 | Stack | Arbitrum Nitro L2 ("an Arbitrum Chain running Arbitrum Nitro"), built on Arbitrum Dedicated Blockchains, Ethereum blobs for DA. ArbOS 61. The docs do **not** use the word "Orbit" | RC-CONNECT, RC-DIFF, RC-NODE | VERIFIED ("Orbit" label UNVERIFIED but immaterial) |
| C-14 | Parent chain | Ethereum. Testnet rollup contracts are on Sepolia (Rollup `0xdc5F8E399DBd8a9F5F87AeC4C23Beb12431b386D`) | RC-FINALITY, RC-PROTO | VERIFIED |
| C-15 | Testnet sequencer feed / endpoint | `wss://feed.testnet.chain.robinhood.com` / `https://sequencer.testnet.chain.robinhood.com` | RC-CONNECT | VERIFIED |
| C-16 | Ordering | Sequencer first-come, first-served. Fees do not buy priority | RC-ROOT, RC-DIFF | VERIFIED |
| C-17 | Sanctions screening | Sequencer excludes transactions tied to sanctioned addresses | RC-DIFF | VERIFIED |
| C-18 | `block.number` semantics | Returns an L1 block estimate that updates only periodically. **Contracts must use `block.timestamp`, not `block.number`, for time windows** | RC-DIFF | VERIFIED |
| C-19 | Block time | No number published | — | UNVERIFIED |
| C-20 | Status page | `http://status.robinhoodchain.offchain.io/` | RC-ROOT | VERIFIED |

## 1b. Robinhood Chain: mainnet (hackathon scope, ADR-0010)

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| M-01 | Mainnet public RPC | `https://rpc.mainnet.chain.robinhood.com` | RC-CONNECT, RH-SUPPORT | VERIFIED. Re-probed 2026-11-10: `eth_chainId` = `0x1237` (4663) |
| M-02 | Mainnet Alchemy RPC | `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` | RC-AA (bundler/RPC row) | VERIFIED endpoint shape |
| M-03 | Mainnet genesis hash | `0xaad15f3d702aaea00caf3e9bb56395efe9127bc3b31b24921abf1eee3409305c` | onchain probe 2026-11-10 | VERIFIED (onchain probe) |
| M-04 | Multicall3 on mainnet | `0xcA11bde05977b3631167028862bE2a173976CA11`: code present (3,808 bytes) | onchain probe 2026-11-10 | VERIFIED (onchain probe) |
| M-05 | Permit2 on mainnet | `0x000000000022D473030F116dDEE9F6B43aC78BA3`: code present | RC-PROTO + onchain probe | VERIFIED |
| M-06 | Mainnet USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | RC-CONTRACTS (explorer links point to mainnet) | VERIFIED (docs). Optional prize asset, Sprint 7 stretch |

## 6b. $WIF: organiser source (supersedes W-01…W-10 where they overlap)

Source: organiser API `GET https://worldisflat.fun/build/api/vote-window`, read by the product owner on 2026-11-10. Hackathon rules: https://worldisflat.fun/build/rules.

| # | Fact | Value | Status |
| --- | --- | --- | --- |
| W-11 | $WIF chain | Robinhood Chain **mainnet**, chain ID `4663` | VERIFIED (organiser source) |
| W-12 | $WIF token address | `0x5173b8ea6923c2d40267890d45c46a3480954773` (checksummed: `0x5173b8eA6923c2d40267890D45C46a3480954773`) | VERIFIED (organiser source). Resolves OQ-P-01. Matches the earlier third-party value in W-03 |
| W-13 | $WIF decimals | `18` | VERIFIED (organiser source) |
| W-14 | Organiser vote contract | `0xd1b711917a405782da2ec650a0ee4711a76a5535`, `vote(uint256,uint256,uint256)`, emits `Voted(address,uint256,uint256)` | VERIFIED (organiser source) |
| W-15 | Vote mechanic | 1 $WIF = 1 vote, burned. **Amended 2026-11-11 (S7-01):** the *organiser* contract `0xd1b7…5535` (651-byte runtime, no proxy) exposes `vote(uint256,uint256,uint256)`, `wif()` = $WIF and `BURN_ADDRESS()` = `0x…dEaD`, and its only token call is `transferFrom` (bytecode selectors `0x23b872dd`, `SafeERC20FailedOperation`). So the organiser path is a **sink transfer to `0x…dEaD`**, which does **not** lower `totalSupply`. It has emitted **no events** since its deploy block 108,517,622 (scanned to 111,685,646), so no real `Voted` tx exists to check yet. **Suiem does not use this path:** `SuiemElections` calls `burnFrom`, which does lower supply (W-16) | VERIFIED (organiser source) + bytecode read 2026-11-11. Organiser path inferred from bytecode, not from a tx (none exist) |
| W-16 | $WIF contract and burn semantics | `0x5173b8eA6923c2d40267890D45C46a3480954773`, 3,248-byte runtime (code keccak `0xbd9466af…f59f`), deployed at block 29,235,958. **Not a proxy** (EIP-1967 implementation slot is zero). `name()` "World is Flat", `symbol()` "WIF", `decimals()` 18, initial `totalSupply` 1,000,000,000 × 1e18. Selectors include `burn(uint256)` `0x42966c68` and `burnFrom(address,uint256)` `0x79cc6790`, plus launchpad views (`launchFactory`, `curve`, `deployer`, `getTokenInfo`, `logo`, `socials`, `description`). **No** `pause`, `owner`, blocklist or fee selectors. Real burns lower supply exactly, e.g. tx `0xaf2a339bf235c98d7b5e3788e0fb153b7a94de09142ca324197215e78ef9e90b` (block 111,449,543: supply 999,995,895,104… → 999,995,894,104…, −1 WIF) and `0xa640e96bfc77734888ef71eea47df2be0668f26499416dbeec00f9dea704b0d6` (−20 WIF). On an anvil fork at block 111,685,000: `burnFrom(PO, 2 WIF)` by an approved spender lowered supply by exactly 2e18 and spent the allowance (3 → 1); a 1 WIF transfer arrived in full (**no fee on transfer**). Same result in the Foundry fork tests against `SuiemElections` | **VERIFIED (onchain read + fork test, 2026-11-11).** Blockscout's API returned HTTP 403 to scripted requests, so the verified-source view was not read; the facts above come from bytecode, `eth_call` and logs via the PO's RPC |

### 6b-2. Mainnet RPC and finality tags (Sprint 7, 2026-11-11)

| # | Fact | Value | Status |
| --- | --- | --- | --- |
| W-17 | PO's QuickNode endpoint (secret, server-side only) | `eth_chainId` = `0x1237` (4663). Serves the `safe` and `finalized` block tags (Arbitrum Orbit), `eth_simulateV1`, and historical `eth_call`. `eth_getLogs` is limited to a **10,000-block range** (error `-32614`) | VERIFIED (probe) |
| W-18 | Finality lag on mainnet | At probe time `finalized` trailed `latest` by a few thousand blocks; the indexer re-scans everything above `finalized` every poll | Observed, not a guarantee (F-02/F-03 still apply) |

## 6c. Stock Token restricted jurisdictions (hackathon rule 5)

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| J-01 | Restricted jurisdictions for Stock Token features | US, CA, GB, CH, CU, BY, IR, KP, RU, SY, UA, SS, SD, MM, VE | https://docs.robinhood.com/rhj/restricted-jurisdictions (list supplied by PO 2026-11-10) | PO-provided with source URL. Not independently re-read in Sprint 2. Re-read before Sprint 5 (task S5-01) |

## 2. Finality

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| F-01 | Soft confirmation | Sub-second, from the sequencer | RC-FINALITY | VERIFIED |
| F-02 | Posted to Ethereum | "Minutes" | RC-FINALITY | VERIFIED |
| F-03 | Ethereum finality | "~13 minutes after posting" | RC-FINALITY | VERIFIED |
| F-04 | L2→L1 withdrawals | 7-day challenge period | RC-BRIDGE | VERIFIED |
| F-05 | Whether the stages above hold the same way on testnet (Sepolia parent) | Docs don't separate the networks | — | UNVERIFIED. Indexer uses `finalized`/`safe` block tags plus configurable depth, so it does not depend on this |

**Design consequence (ADR-0002):** the indexer tracks three states: `soft` (sequencer receipt), `safe` (batch posted, RPC `safe` tag) and `final` (RPC `finalized` tag). Election results finalize only after every vote event is `final`.

## 3. Faucet and test assets

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| T-01 | Faucet URL | `https://faucet.testnet.chain.robinhood.com` | RH-SUPPORT, RH-NEWS, ARB-BLOG | VERIFIED (the page itself returned HTTP 429 when fetched, so its UI was not inspected) |
| T-02 | Faucet dispenses | "testnet ETH (used for transaction fees) and test versions of Stock Tokens, including Tesla, Amazon, Palantir, Netflix, and AMD, with more to come" | ARB-BLOG | VERIFIED (Arbitrum official blog; not repeated in docs.robinhood.com) |
| T-03 | Faucet amounts / cooldown | Third-party guides disagree (0.01 ETH + 5 tokens per 24h, etc.) | — | UNVERIFIED |
| T-04 | Testnet asset value | "Testnet tokens have no real-world value and are only for development use." | RH-SUPPORT, ARB-BLOG | VERIFIED |
| T-05 | Testnet Stock Token **contract addresses** | TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, AMZN `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`, PLTR `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0`, NFLX `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93`, AMD `0x71178BAc73cBeb415514eB542a8995b82669778d`. Names "Tesla", "Amazon", "Palantir Technologies", "Netflix", "AMD"; all share one code hash (`0x2f367e6a…`); supply ≈ 6.61M each | Onchain trace 2026-11-11: the testnet contract labelled **"Faucet"** `0x8762F93772c663c6a88Ba50900bd5381df2717Be` (`sendTokensAndEther`, called by operator `0xF691446e9386DEDF7364340fE35B09E8fE884d81`) mints 5 of each of exactly these five tokens to each claimant in one transaction (e.g. tx `0x7701ca2b…4732`; 26 distinct recipients on the latest page). Look-alikes ("TSLA Test Stock", "TESLA", Edel/Aave wrappers) never appear in faucet transactions | **VERIFIED (onchain trace).** Resolves OQ-P-03. Registry `TEST:*` set `active` |
| T-06 | Testnet Stock Token decimals | `18` for all five (`decimals()` read onchain 2026-11-11) | onchain read | **VERIFIED (onchain read)** |
| T-07 | Testnet L2 WETH | `0x7943e237c7F95DA44E0301572D358911207852Fa` | RC-PROTO | VERIFIED |
| T-08 | Testnet L2 Multicall (Arbitrum `Multicall2`-style, **not** canonical Multicall3) | `0xa432504b6F04Cafe775b09D8AA92e8dbe41Ec7a8` | RC-PROTO | VERIFIED |
| T-09 | Canonical Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` on testnet | Not listed | — | UNVERIFIED. Check `eth_getCode` before use |
| T-10 | Permit2 (both networks) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | RC-PROTO | VERIFIED |
| T-11 | Testnet L2 Gateway Router | `0x77bF00A6A90c600f214b34BAFBB7918c0cF113A8` | RC-PROTO | VERIFIED |
| T-12 | Testnet stablecoin (USDG or other) | USDG is listed for mainnet only (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, unlabeled network on RC-CONTRACTS) | RC-CONTRACTS | Testnet stablecoin UNVERIFIED |

## 4. Account abstraction and wallets

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| A-01 | ERC-4337 support | "first-class support for ERC-4337 account abstraction". EIP-7702 also supported | RC-AA | VERIFIED (network-generic statement) |
| A-02 | EntryPoint v0.7.0 / v0.8.0 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` / `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` (listed under chain 4663) | RC-AA | VERIFIED for **mainnet**. Testnet deployment UNVERIFIED (check with `eth_getCode`) |
| A-03 | Bundler / paymaster providers | Alchemy (primary, Gas Manager policy), ZeroDev (`.../chain/4663`), Privy, Dynamic | RC-AA | VERIFIED for mainnet. **Testnet bundler/paymaster URLs UNVERIFIED** |
| A-04 | Session keys | "session key support" mentioned, no mechanism specified | RC-AA | UNVERIFIED as to implementation |
| A-05 | Passkey (WebAuthn / P-256) smart accounts | Not mentioned | — | UNVERIFIED. Depends on the chosen provider (e.g. ZeroDev/Alchemy WebAuthn validators) and whether RIP-7212 P-256 precompile exists on ArbOS 61 (not checked) |
| A-06 | Recommended wallets | Robinhood Wallet. "EVM Wallets (MetaMask and more)" | RC-WALLET | VERIFIED |

### 4a. Phase 2 AA verification spike (ADR-0002 §3), 2026-11-10

Method: read-only JSON-RPC against `https://rpc.testnet.chain.robinhood.com` (no transactions, no keys). `eth_chainId` returned `0xb626` (46630). Latest block at probe time was `0x905752d`. Genesis hash `0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32` (stored for testnet-reset detection, ADR-0002 §1). Bytecode identity was checked by comparing SHA-256 of `eth_getCode` on testnet vs mainnet (`https://rpc.mainnet.chain.robinhood.com`).

| # | Fact | Value | Status |
| --- | --- | --- | --- |
| A-07 | EntryPoint v0.6.0 on testnet | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`: code present (23,689 bytes), bytecode identical to mainnet | VERIFIED (onchain probe) |
| A-08 | EntryPoint v0.7.0 on testnet | `0x0000000071727De22E5E9d8BAf0edAc6f37da032`: code present (16,035 bytes), identical to mainnet | VERIFIED (onchain probe) |
| A-09 | EntryPoint v0.8.0 on testnet | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`: code present (21,738 bytes). **Bytecode differs from mainnet.** That is consistent with chain-ID-dependent EIP-712 immutables, but source identity is not checked | Code present VERIFIED. Equivalence UNVERIFIED (check verified source on Blockscout before use) |
| A-10 | Safe 4337 Module v0.3.0 / Module Setup on testnet | `0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226` (identical to mainnet) / `0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47` (code present) | VERIFIED (onchain probe) |
| A-11 | SenderCreator v0.7 on testnet | `0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C`: code present | VERIFIED (onchain probe) |
| A-12 | RIP-7212 P-256 verify precompile at `0x…0100` | A freshly generated valid P-256 signature returned `0x…01`. A tampered signature returned `0x` | VERIFIED (onchain probe). Passkey signature verification is natively available |
| A-13 | Testnet ERC-4337 **bundler** (Alchemy/ZeroDev for 46630) | Can't be checked without a provider account/API key | UNVERIFIED |
| A-14 | Testnet **paymaster** | Same | UNVERIFIED (and OFF by PO decision OQ-S-02) |
| T-13 | Canonical Multicall3 on testnet | `0xcA11bde05977b3631167028862bE2a173976CA11`: code present (3,808 bytes) | Code present VERIFIED (supersedes T-09's UNVERIFIED) |
| T-14 | Permit2 on testnet | `0x000000000022D473030F116dDEE9F6B43aC78BA3`: code present | VERIFIED (onchain probe, consistent with T-10) |
| T-15 | Safe v1.4.1 singleton / proxy factory (canonical addresses) | `0x41675C099F32341bf84BFc5382aF534df5C7461a` / `0x4e1DCf7AD4e460CfD30791CCC4F9C8a4f820ec67`: code present | Code present VERIFIED. Source identity UNVERIFIED (relevant to OQ-S-03) |
| C-21 | Testnet genesis hash | `0x829a42e6d68c872aafcef3abb2123fe371138fc415dd8b44381bbbf23049dd32` | VERIFIED (onchain probe) |

**Outcome (per PO decision OQ-PR-05):** the AA *contracts* and P-256 verification exist on testnet, but bundler and paymaster availability is unverified. So AA is **not confirmed end-to-end**. Phase 2 ships **external wallets via SIWE only** with a stubbed `SmartAccountProvider` interface. Re-check A-13 once a provider account exists.

## 5. Stock Tokens (mainnet product: context for the "never present as real shares" rule)

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| S-01 | Issuer | Robinhood Assets (Jersey) Limited ("RHJ"), Jersey reg. 162428 | RC-STOCK | VERIFIED |
| S-02 | Legal nature | "tokenised debt securities". Holders get "economic exposure" and **no** legal or beneficial rights in the underlying shares | RC-STOCK | VERIFIED |
| S-03 | Standard | ERC-20, 18 decimals. Corporate actions via `uiMultiplier()` (ERC-8056) with static balances | RC-STOCK | VERIFIED |
| S-04 | Restrictions | Not registered under US securities laws. Not offered to US persons. Restrictions also apply in Canada, UK and Switzerland | RC-STOCK | VERIFIED. **India: not mentioned → legal question OQ-L-02** |
| S-05 | Primary issuance | Only Authorised Participants (at issuance: BBVI), KYB required. Mint window Mon 02:00 – Sat 02:00 CET/CEST | RC-STOCK | VERIFIED |
| S-06 | Mainnet venues | RFQ (0x RFQ, 1inch Fusion, LiFi), AMMs (Uniswap), propAMM Rialto, Lighter (spot & perps) | RC-BUILD | VERIFIED (mainnet). **Testnet venue: none found → UNVERIFIED** |
| S-07 | Price oracle | Chainlink. Stock feeds update 24/5. Feed addresses are only at `https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood` | RC-ORACLE | Provider VERIFIED. Testnet feed addresses UNVERIFIED (not fetched) |

## 6. $WIF

| # | Fact | Value | Source | Status |
| --- | --- | --- | --- | --- |
| W-01 | Token exists on Robinhood Chain mainnet | Listing titles "World is Flat (WIF)" on CoinMarketCap. Multiple hackathon repos build on it | coinmarketcap.com/currencies/world-is-flat (fetch failed), github.com/DevDee3/Flat-ballot, github.com/angelraph/equalship | UNVERIFIED (no primary source reached) |
| W-02 | Name | "World is Flat" (CMC title) vs "World is Fair" (voting system name in 3rd-party READMEs) | as above | UNVERIFIED. The relation between the two names needs PO confirmation |
| W-03 | Contract address | `0x5173b8eA6923c2d40267890D45C46a3480954773` **appears in two third-party hackathon READMEs only** | Flat-ballot, Equalship READMEs | **UNVERIFIED. DO NOT USE. PO confirmation item OQ-P-01.** Recorded only so reviewers can compare it with the official source |
| W-04 | Lookalikes | The brief reports several WIF-named tokens on Robinhood Chain, including a bridged "Bitstamp WIF" | brief | UNVERIFIED. Treated as an active impersonation risk |
| W-05 | Launchpad / supply | Pons v2, fixed 1B supply | brief, atomicwallet.io article on Pons | UNVERIFIED |
| W-06 | Decimals | 18 (Equalship README comment) | 3rd party | UNVERIFIED |
| W-07 | `burn()` that lowers `totalSupply` | Equalship README: "Every burn calls `WIF.burn()` and lowers total supply" | 3rd party | UNVERIFIED. Must be checked against verified source on Blockscout |
| W-08 | Voting mechanic | Conflicting: (a) brief: send WIF to a candidate deposit address, collected tokens destroyed after the event; (b) Flat-ballot: "Voters send $WIF to the option they back. Every vote is burned." (per-option deposit address); (c) Equalship: `vote` burns directly, 1 WIF per vote, farmed-vote check offchain after close | brief + 3rd party | **UNVERIFIED and conflicting → OQ-P-02** |
| W-09 | Testnet deployment of $WIF | None found | — | UNVERIFIED (assume none). Suiem uses `TestWIF` (ADR-0005) |
| W-10 | Official World is Fair site/docs | Not found | — | UNVERIFIED → OQ-P-01 |

## 8. AI research providers and data (Sprint 4, checked 2026-11-11)

Keys live only in the git-ignored `.env`. These were probed live with those keys; no key values are recorded anywhere.

| ID | Fact | Value | Source / method | Status |
| --- | --- | --- | --- | --- |
| R-01 | Primary LLM | Groq `openai/gpt-oss-120b` via `https://api.groq.com/openai/v1/chat/completions`, Structured Outputs `response_format: {type: "json_schema", json_schema: {strict: true}}`, `reasoning_effort: "low"` | `GET /openai/v1/models` lists `openai/gpt-oss-120b`; strict-schema call returned `{"ok":true}` | VERIFIED (live probe) |
| R-02 | Fallback LLM | Gemini **`gemini-3.5-flash`** via `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent` (header `x-goog-api-key`), `responseMimeType: application/json` + `responseSchema`, `thinkingConfig.thinkingLevel: "low"` | `GET /v1beta/models` (Flash models with `generateContent`); test calls: `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-flash-latest` → 200; `gemini-2.5-flash` → 404 "no longer available to new users". Chose 3.5 Flash (current, stable name, not preview) | VERIFIED (live probe) |
| R-03 | Gemini thinking budget | Thinking tokens count against `maxOutputTokens`: with the default level a brief hit `MAX_TOKENS` after 3,693 thought tokens. With `thinkingLevel: "low"` and 8,192 max tokens: `STOP`, 1,430 thought tokens | live probe | VERIFIED |
| R-04 | Gemini free-tier data use | Google may use free-tier content to improve its products | PO brief (Sprint 4) | PO-provided. Disclosed in Help and the extension preview |
| R-05 | Groq free-plan limits | ~30 RPM, 1K RPD, 8K TPM, 200K TPD for gpt-oss-120b | PO brief (Sprint 4) | PO-provided. A 429 was observed live when two briefs ran within a minute (fallback worked) |
| R-06 | SEC EDGAR endpoints | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`, `https://data.sec.gov/submissions/CIK##########.json`, ticker map `https://www.sec.gov/files/company_tickers.json` | live calls with `User-Agent` from `SEC_USER_AGENT` → 200 | VERIFIED |
| R-07 | SEC fair access | `User-Agent` required; ≤ 10 req/s (Suiem throttles to ~5) | PO brief + SEC policy | PO-provided; adapter refuses to run without `SEC_USER_AGENT` |
| R-08 | Foreign filer XBRL | TSMC (CIK 0001046179, files 20-F/6-K) has **no `us-gaap` facts** in companyfacts → highlights unavailable, brief `partial` | live call (recorded in `workers/research/fixtures/edgar-facts-0001046179.json`) | VERIFIED |
| R-09 | Finnhub endpoints | `https://finnhub.io/api/v1/` `quote`, `stock/profile2`, `stock/peers`, `stock/metric?metric=all`, `company-news`; key in header `X-Finnhub-Token` (40 chars) | live calls → 200 | VERIFIED |
| R-10 | Finnhub news URLs | `company-news` returns `https://finnhub.io/api/news?id=…` redirect links (not the publisher URL); for NVDA the 30-day feed also includes general market stories | recorded fixtures | VERIFIED. Shown as returned; publisher name kept |
| R-11 | Finnhub free plan | Non-commercial; ~60 calls/min (Suiem throttles to ~30/min). Labelled "Data: Finnhub (free tier)" | PO brief | PO-provided |
| R-12 | CIK map | 35/35 dictionary companies mapped (e.g. NVIDIA 0001045810, Apple 0000320193, TSMC 0001046179) → `packages/shared/src/entities/cik-map.ts` | `scripts/gen-cik-map.ts` on 2026-11-11 | VERIFIED |

## 9. Testnet Stock Tokens and the Suiem demo venue (Sprint 5)

The Sprint 4 candidates were **confirmed** on 2026-11-11 (see T-05/T-06). J-01 was re-read the same day (S5-01): the RHJ page lists the U.S., Canada, the United Kingdom and Switzerland, plus Prohibited Investors in Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar and Venezuela. **Unchanged**; `jurisdictions.ts` needs no edit.

| ID | Fact | Value | Status |
| --- | --- | --- | --- |
| D-01 | SuiemDemoVenue (testnet 46630) | `0xfdc540781EE7ab03fD397201A21B87Cf2321704F` (owner `0x8A11…D4C8`, quote signer `0x4553…4182`) | VERIFIED (our deployment, block 151705539, Blockscout-verified) |
| D-02 | DemoUSD (dUSD, 6 dp) | `0xbB9795F4b4Bddb993539Ee44249D83E7625DD045` | VERIFIED (ours) |
| D-03 | Demo tokens (18 dp) | dTSLA `0xb46d40bbfb8798c93b0def0eac6b5cc66fd02731`, dAMZN `0xb7a347D53CbC404BC8b9612e0df4B04450b217A6`, dPLTR `0xc7821521505D5cad7A094805953a788136458633`, dNFLX `0xd0cb704D45cdf60f07512a4DCa5e2791F97680A4`, dAMD `0xC6D7F579208e2f62Ae798a757ad87F3ceC280a21` | VERIFIED (ours) |
| D-04 | Testnet gas price | 0.01 gwei (base fee 10,000,000 wei) on 2026-11-11 | Observed |

Source of truth: `packages/contracts/deployments/46630.json`.

## Re-verification

Run this checklist again before Phase 4 (instrument registry) and Phase 7 (contract deploy), and record the new date:
1. `eth_chainId` on the testnet RPC returns `0xb626` (46630).
2. `eth_getCode` is non-empty for EntryPoint v0.7/v0.8, Multicall3, Permit2 and each Stock Token address before it enters the registry.
3. Each Stock Token's `name/symbol/decimals` is read onchain and the source is verified on Blockscout.
