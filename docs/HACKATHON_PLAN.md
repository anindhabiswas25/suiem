# Suiem: World is Flat Hackathon Plan

- **Submissions close:** 12 Nov 2026, 17:30 UTC (edits lock then)
- **Must stay live until:** 16 Nov 2026, 17:30 UTC
- **Rules:** https://worldisflat.fun/build/rules
- **Decision record:** ADR-0010 (two networks, mainnet exception), decision 0001, `decisions/OPEN_QUESTIONS.md`

## Goal

The whole Suiem flow working end to end, for real:
extension → AI research → thesis/watchlist → testnet Stock Token order → social → 50/50 reputation → **$WIF election on mainnet** → results.

## Hackathon requirements → where they are met

| # | Rule | How Suiem meets it | Sprint |
| --- | --- | --- | --- |
| 1 | Use $WIF onchain on Robinhood Chain with real transactions | `SuiemElections` burn-to-vote on mainnet 4663 against $WIF `0x5173…4773` (W-12). Optional $WIF tips to research authors | 7 |
| 2 | A flywheel that keeps bringing people back to $WIF | See below | 6–7 |
| 3 | Proof: repo, demo video, real transactions | Repo (public or invite `wifonrh`), video script, list of tx hashes in the submission | 8 |
| 4 | No Robinhood name or logo. Follow the brand guidelines. Disclaimer | Suiem wordmark only. Footer and Help: "Suiem is not affiliated with Robinhood Markets, Inc." | 2 (shell), 8 (review) |
| 5 | Respect the Stock Token restricted list | Server-side jurisdiction check on every Stock Token route (J-01). Undeclared country = blocked | 2 (stub), 5 |

## The flywheel

```
 research & publish theses ──► weekly elections ("Research Contributor", "Investor")
          ▲                         │  community votes by BURNING $WIF (1 $WIF = 1 vote)
          │                         ▼
 more research & better theses ◄── winners: profile spotlight (+ prefunded USDG prize if available)
```

- $WIF has a **real, recurring use**: every weekly election consumes it.
- Winners are chosen by the community. The **Suiem Score is separate**: votes and holdings never change it (ADR-0005, ADR-0010 §3), so the spotlight can't be bought into the score.
- Prizes, if any, are **prefunded** USDG. Nothing is promised from $WIF price. "$WIF has no promise of value or return" appears in Help.

## Sprints

Times are rough targets in UTC. Each sprint ends with a commit, `docs/sprints/SPRINT_N.md`, and a STOP for PO approval.

| # | Sprint | Budget | Key outputs | Exit check |
| --- | --- | --- | --- | --- |
| 1 | Discovery | done | Phase 1 docs, ADRs 0001–0009 | Approved |
| 2 | Foundation + app shell | ~5h | Monorepo; DB schema for the whole demo; passkey + SIWE auth; both networks in wagmi; every nav route; design system; deploy-ready | `SPRINT_2.md` checks |
| 3 | Suiem Intelligence extension | ~6h | WXT MV3; ON/PAUSED/OFF/PRIVATE truly gating work; local entity detection; dismissible notification; side panel; user-invoked research; local daily digest | OFF/PAUSED = zero activity test |
| 4 | AI research, registry, watchlist, thesis | ~6h | Entity/instrument registry seed; Claude research pipeline (brief v1 schema, citations, real retrieved sources only); research page; watchlists; thesis create/version/publish | Briefs validate; no uncited claims |
| 5 | Invest on testnet | ~5h | S5-01 re-read restricted list; verify testnet Stock Token addresses (OQ-P-03) or deploy a labelled demo venue on 46630 (PO approval); portfolio; order preview (quote time, fees, slippage, network); user-signed testnet buy; reconciliation from the receipt; separate simulated book | One real testnet tx, reconciled |
| 6 | Social + reputation | ~6h | Feed; profiles with privacy; follow; publish; comments; helpful votes; Suiem Score v1 (50/50) with "Building track record"; leaderboard; methodology page | Score reproducible; $WIF has no effect (test) |
| 7 | $WIF economy on mainnet | ~7h | **S7-01** onchain check of $WIF `burn`/`burnFrom` and the organiser vote contract (W-14/W-16); `SuiemElections` (burn-to-vote, holds no tokens, no upgradeability); fork tests on anvil-4663; indexer (unique chain_id+tx_hash+log_index, reorg-safe); elections UI with an irreversible-burn review screen; results. **Mainnet deploy only after PO approval.** Optional USDG prize escrow | Real mainnet vote tx indexed |
| 8 | Ship + submit (by 12 Nov 15:00 UTC) | ~6h | Deploy to Vercel + Railway; Playwright golden-path E2E across the whole flow; seed demo data; demo video script; README; submission text; list of real transactions; uptime check until 16 Nov | Submitted before 17:30 UTC |

## Deferred until after the hackathon

External audits, legal sign-off, pen tests, load tests, dual control (ADR-0011), cloud secret managers, full RLS, multi-provider failover, OpenTelemetry export.

## Logged tasks

| ID | Task | Sprint |
| --- | --- | --- |
| S5-01 | Re-read https://docs.robinhood.com/rhj/restricted-jurisdictions and update J-01 | 5 |
| S5-02 | Resolve testnet Stock Token addresses (OQ-P-03) | 5 |
| S7-01 | `eth_getCode` + Blockscout ABI for $WIF (`burn`/`burnFrom`) and organiser contract `0xd1b7…5535` (how it burns) | 7 |
| S8-01 | Decide repo visibility (OQ-H-01) | 8 |
