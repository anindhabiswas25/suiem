# Suiem Score methodology

- Active methodology: **`v1-hackathon`** (production **`v1`** is in code; switching is one constant, `ACTIVE_METHODOLOGY` in `workers/reputation/src/engine/methodology.ts`).
- Source of truth: `workers/reputation/src/engine/` (pure, deterministic). Served as JSON at `GET /api/v1/reputation/methodology`. The web page `/leaderboard/methodology` will show the same content.
- References: PRD §10, ADR-0005, ADR-0010 §3, PO decision OQ-P-07 (Sprint 6).

> **The Suiem Score is not a prediction of future returns and not a financial rating.**
> Every investor input comes from the **simulated** and **testnet demo** books: **"Simulated / testnet performance, not live verified."** Faucet test-token holdings are not performance.

## 1. Formula

```
Suiem Score = 0.50 × Investor Performance + 0.50 × Community Contribution        (each 0–100)

Investor     = 0.40 × Risk-adjusted performance + 0.30 × Thesis outcome
             + 0.20 × Consistency               + 0.10 × Risk management
Contribution = 0.40 × Research quality          + 0.30 × Helpful feedback
             + 0.20 × Educational               + 0.10 × Participation
```

- **Integer arithmetic only:** ratios are parts per million and points are micro-points. Totals are rounded **half-even to 2 decimals** with the shared decimal library (`@suiem/shared/money`). No floating point is ever persisted.
- **A component without enough data scores 0, never a neutral 50.** It is shown as "insufficient data". Missing data is never treated as success.
- **Reproducible:** the same evidence and methodology give byte-identical canonical JSON. Input order doesn't matter. This is tested.

## 2. Components

### Investor Performance (50%)

| Component | Weight | Rule |
| --- | --- | --- |
| Risk-adjusted performance | 40% | Each closed (realized) trade from reconciled fills gives a return `r = (proceeds − cost removed) / cost removed` (average-cost method, fees included). Its excess is `e = r − SPY return over the holding period`, using the nearest SPY mark within 36 h of the open and the close. Score = `clamp(50 + 250 × (mean(e) − 0.5 × stdev(e)), 0, 100)`. It is used only with ≥ N closed trades that have a benchmark, over ≥ D days (table below). Trades without benchmark marks never get credit. The chain-linked (time-weighted) return of closed trades is shown alongside. |
| Thesis outcome | 30% | Share of evaluated theses that were directionally right against SPY, shrunk toward 50% by a Bayesian prior: `(correct + k/2) / (evaluated + k)`. One lucky call scores 60, not 100 (k = 4). |
| Consistency | 20% | Share of positive daily evaluation periods. A day is positive when more trades beat SPY and theses were right than not. |
| Risk management | 10% | `100 − 2 × max drawdown % − (largest open position % of its book − 50)` when concentration is above 50%. The drawdown is taken on the chain-linked closed-trade equity curve. Books are never summed. |

### Community Contribution (50%)

| Component | Weight | Rule |
| --- | --- | --- |
| Research quality | 40% | Applies to each published thesis (not private, not draft) and each shared research brief post. Points: sources (≥ 2: 25, 1: 15), counterarguments (20), risks (20), invalidation (20) and length between 200 and 8,000 characters (15). **Near-duplicates score 0:** word 5-shingle Jaccard ≥ 0.80 against any earlier research by anyone, including the user's own. AI-assisted items count at half weight. The average is scaled by confidence `min(originals, F) / F`. |
| Helpful feedback | 30% | Weighted net helpful votes (helpful − not helpful) on research and discussion posts. Saturating curve: `100 × net / (net + H)`. |
| Educational | 20% | The same curve, for votes on learning notes and on answers (top-level comments on questions). |
| Participation | 10% | `60 × min(helpful comments, 5)/5 + 40 × min(distinct active days, 7)/7`, capped at 100. |

**Rater weighting** (votes, Discover ranking):

- Each rater counts at most **once per author per UTC day**.
- Weight is halved when the rater's account was **< 24 h old** at vote time. It is also halved when the rater had **no published research before the vote**. Both together give ¼.
- **Reciprocal helpful rings** (A→B and B→A both ≥ 3 helpful votes) count at **¼**.
- **Demo accounts' votes count 0** toward non-demo users. Self-votes count 0 (and the API forbids them).
- Only raters at full weight count as **trusted raters** for maturity.

## 3. Maturity and thresholds

| Threshold | `v1-hackathon` (active) | `v1` (production) |
| --- | --- | --- |
| Evaluated decisions (closed trades + evaluated theses) | ≥ 5 | ≥ 10 |
| Distinct active days | ≥ 3 | ≥ 10 |
| Account history | none | ≥ 90 days |
| Trusted raters who marked the user's work helpful | ≥ 3 | ≥ 3 |
| Closed trades with a benchmark, for risk-adjusted performance | ≥ 3 over ≥ 1 day | ≥ 10 over ≥ 30 days |
| Thesis prior strength k | 4 | 10 |
| Helpful half-point H | 5 | 10 |
| Research full-confidence items F | 3 | 10 |
| Badge | **Hackathon season · limited history · preview** | none |

- **`building`:** no score is stored or shown (DB CHECK: building snapshots have no totals). The card shows "Building track record: X of 5 evaluated decisions, Y of 3 days, Z of 3 raters".
- **`ranked`:** the score with its breakdown, the badge, the methodology version, the evaluation period and "Simulated / testnet performance".

## 4. Thesis evaluation

- At the end of the horizon (as short as 1 day), the job evaluates the **frozen version 1**. Later versions never change it. `thesis_evaluations` is append-only, with one row per thesis.
- **Correct** means:
  - bullish: the instrument beat SPY;
  - bearish: it trailed SPY;
  - neutral: it ended within ±2% of SPY.
- **Prices and benchmark:**
  - The start price and SPY are captured when v1 is written (Finnhub quote). For older theses, the nearest hourly SPY mark is used.
  - The end prices are Finnhub quotes at evaluation time.
  - A thesis is **unevaluable** if a price is missing or evaluation runs more than 72 h late. Unevaluable theses never count as correct.
- **What counts toward the score:** only theses published within 24 h of being written, and at most one per company per day. This stops cherry-picking and farming decisions with private theses.
- **Benchmark disclosure:** SPDR S&P 500 ETF (SPY) via the Finnhub free-tier quote. SPY is a broad, liquid proxy for the US large-cap market, and every Suiem demo instrument is a US large-cap company.

## 5. Integrity rules

1. **Votes and $WIF never affect the Suiem Score.** No data path exists from elections, token balances or burns to the score. This is enforced by the depcruise rule `reputation-no-economy` and a source-scan test.
2. **Never counted:** $WIF balances or votes, post counts, AI report counts, browsing time, follower counts, paid promotion or anything paid. Property tests check that arbitrary values for these change nothing.
3. Rater-diversity weighting, ring and sockpuppet discounts, and zero weight for demo raters (§2).
4. Near-duplicate research earns zero quality.
5. Missing or unverifiable data scores zero; it is never treated as a neutral midpoint.
6. AI-assisted content counts at half weight. The label is set by the server and can't be removed: briefs always carry it, and so does a thesis on a company (or citing a brief) the AI drafted for in the last 30 days.
7. **Rate limits:** 10 posts per hour, 30 comments per hour, 50 helpful votes per day. Nobody can react to their own post.
8. **Snapshots:** the jobs run at least hourly (every 15 minutes in the API process), and also right after each relevant action. A snapshot is written only when its content changes. Each one stores every component, an inputs summary, the methodology version, the maturity and a link to the previous snapshot ("What changed").
9. **Appeals:** a moderator either marks an appeal reviewed or re-runs the same deterministic engine, and either way it is audited. Moderators can't resolve their own appeals or reports about their own content.
10. Leaderboards are **opt-in**, list only `ranked` profiles, and exclude demo accounts unless "show demo accounts" is on.

## 6. Worked example (from `workers/reputation/src/engine/score.test.ts`)

| Component | Inputs | Score |
| --- | --- | --- |
| Risk-adjusted | 3 closed trades, each +5% vs SPY +1% → excess +4% each, stdev 0 → 50 + 250 × 0.04 | 60.00 |
| Thesis outcome | 4 evaluated, 3 correct, k = 4 → (3 + 2) / (4 + 4) | 62.50 |
| Consistency | 5 evaluation days, 4 positive (one day had 1 right and 1 wrong thesis) | 80.00 |
| Risk management | no drawdown; largest position 60% of its book → 100 − 10 | 90.00 |
| **Investor** | 0.4 × 60 + 0.3 × 62.5 + 0.2 × 80 + 0.1 × 90 | **67.75** |
| Research quality | 3 original items scoring 100, 90 and 80, full confidence | 90.00 |
| Helpful feedback | 5 trusted raters, net 5 → 100 × 5 / (5 + 5) | 50.00 |
| Educational | the same 5 raters on a learning note (another day) | 50.00 |
| Participation | 2 helpful comments → 24; 7 active days → 40 | 64.00 |
| **Contribution** | 0.4 × 90 + 0.3 × 50 + 0.2 × 50 + 0.1 × 64 | **67.40** |
| **Suiem Score** | 0.5 × 67.75 + 0.5 × 67.40 = 67.575 → half-even | **67.58** |

The same evidence under `v1` stays `building`: it has 7 of 10 decisions and less than 90 days of history.
