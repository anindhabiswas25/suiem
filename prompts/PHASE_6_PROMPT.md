You are the staff engineer for Suiem. Sprint 5 (invest on testnet) is DONE and APPROVED. The demo venue is deployed and verified on 46630, and real testnet trades were reconciled.

This is **SPRINT 6 of 8: Social + Reputation**. Budget about 6 hours. This is the world is flat hackathon build, and **submissions close 12 Nov 2026, 17:30 UTC**. Sprint 7 ($WIF elections) builds on this sprint's profiles and leaderboards, so finish the **P0** items first. Do **P1** only if time allows, and list anything cut in the report.

**Work in this single session. Do not spawn subagents or fan out parallel agents.**

## Read first

- `docs/HACKATHON_PLAN.md`
- `docs/sprints/SPRINT_5.md`
- ADR-0005 (reputation and voting) and ADR-0010
- PRD §5.5 (social discovery), §8.6 (follow portfolio, read-only), §9 (feed, post types, interactions, profile privacy, moderation), §10 (50/50 score: components, rules, integrity, profile display), Appendix A items 10, 11 and 14
- migration `0001_foundation.sql` (`users.handle`/`display_name`, `profiles` with per-field visibility, `follows`, `posts`, `comments`, `reactions`, `bookmarks`, `reputation_evidence`, `reputation_snapshots` with its "building → no score" CHECK), migrations 0004–0005 (`theses`, `thesis_versions`, `thesis_reviews`, `fills`, `positions`, `ledger_entries`)

Work on branch `hackathon/main`. Make small conventional commits. Do not push.

## PO decisions

- **OQ-H-06:** an optional free-text display name. The handle defaults to `user-xxxx` and can be changed once in Settings (validated against the existing regex, unique).
- **OQ-P-07 (hackathon season):** the PRD's production thresholds (≥ 90 days, ≥ 10 evaluated decisions) would leave every profile unranked during the hackathon. So:
  - Ship methodology **`v1-hackathon`** with: **≥ 5 evaluated decisions** (closed/realized trades in the simulated or testnet-demo book, plus evaluated theses), activity on **≥ 3 distinct days**, and helpful feedback from **≥ 3 distinct raters**.
  - Every score shows the badge **"Hackathon season · limited history · preview"**.
  - Keep `v1` (the production thresholds) in code as well, so switching is one config change.
  - Document both on the methodology page.
- **Thesis evaluation:** horizons can be as short as 1 day. At the horizon end, a job evaluates the frozen **v1** thesis: was the direction correct on return relative to the benchmark? The benchmark is SPY via the Finnhub quote, disclosed. The job stores a `thesis_evaluation` (append-only) and produces evidence. Later versions never change the evaluation.
- **Performance labels:** all investor evidence comes from the **simulated** and **testnet demo** books, so profiles must say "Simulated / testnet performance, not live verified" (PRD §10.2). Faucet holdings are not performance.
- **Seeded demo accounts** (for the judges, built in Sprint 8): add an `is_demo` flag now. Demo accounts get a visible "Demo account" badge everywhere, and are excluded from leaderboards unless a "show demo accounts" toggle is on. Never backdate evidence.
- **Moderation:** add `users.role` (`user` or `moderator`), set only by a CLI script (`pnpm user:role <handle> moderator`), never through the API.

## P0: build first

### 1. Profiles and privacy (PRD §9.4)

- Public profile `/u/[handle]`: display name, bio, joined date, the Suiem Score card (§3 below), published theses and research, followers/following counts (if `followers_visibility` allows), and badges ("Demo account", "Hackathon season").
- **Settings → Profile & privacy:** each field (portfolio, positions, transactions, thesis, research activity, followers list, wallet, leaderboard appearance) is set to private, followers or public. Defaults stay private (leaderboard off). Explain each one in a sentence.
- A linked wallet address is **never** shown unless `wallet_visibility` allows it. Show the onchain-publicity caveat at the moment it is enabled.
- **Read-only portfolio snapshot:** if the user allows it, the profile shows **allocation percentages per book, with the book label and timestamp**. No quantities, no amounts, no addresses. There is **no copy-trade path**: "Save portfolio" only creates a watchlist from the snapshot's instruments.

### 2. Social graph, posts, feed

- Follow/unfollow, mute, block. Migration `0006_social.sql` adds `mutes`, `blocks`, `moderation_reports`, `thesis_evaluations`, `reputation_appeals`, `notifications`, `users.role` and `users.is_demo`. Grant least privilege to `suiem_app`.
- A blocked user can't follow, comment on or react to the blocker. Muted authors disappear from the muter's feed.
- **Publishing:** "Share to feed" from a thesis (on publish), from a research brief, a discussion about a company, a question, a learning note, or a portfolio snapshot (percentages only).
- **Labels on every post:** "Sourced" (linked brief or thesis with sources), "AI-assisted" (a brief, or a thesis drafted with AI; set automatically, the user can't remove it), "Sponsored" (always false for now; the UI supports it), "Simulated/testnet" on portfolio posts.
- **Nothing is public by default:** the composer defaults to the thesis or brief's own visibility, and the user picks it explicitly.
- **Comments and replies** (one level of nesting is enough), reactions (`helpful`, `not_helpful`; drop `like` from the UI), bookmarks, share (copy link), and report.
- **Rate limits:** posts 10/hour, comments 30/hour, helpful votes 50/day per user. You can't react to your own post. The `helpful` and `not_helpful` reactions on one post are mutually exclusive.
- **User content is rendered as plain text** (with linkified, `rel="nofollow noopener"` URLs only). No raw HTML or markdown HTML, so there is no XSS. Add an XSS test.
- **Feed `/feed`:**
  - Tabs: **Following** and **Discover**.
  - Discover ranking: recency decay + helpful score (rater-weighted, see below) + a diversity cap (max 2 posts per author per page) + trending companies (research/thesis activity per entity in the last 24h).
  - Muted, blocked and deleted posts and non-visible posts are excluded server-side.
  - Cursor pagination.
- **Company pages:** `/research/[entityId]` gains a "Community" tab with posts about that company.
- **Notifications (in-app only):** new follower, comment or reply on your post, helpful on your post, thesis evaluated. Shown in `/notifications` with an unread count.

### 3. Reputation engine (PRD §10, methodology `v1-hackathon`)

The engine lives in `workers/reputation` (create it) or an API module. It must be a **pure, deterministic** scoring function `score(evidence[], methodology) → snapshot`, plus jobs that collect evidence and write snapshots on change and at least hourly.

- **Investor Performance (0–100), 50% of the total:**
  - **Risk-adjusted performance, 40%:** time-weighted return vs SPY over the user's reconciled fills (simulated + testnet demo, labelled), with a volatility penalty. Use it only when the minimum history exists; otherwise the component is "insufficient data", which is not success.
  - **Thesis outcome, 30%:** the share of evaluated theses that were directionally correct vs the benchmark, shrunk toward 50% with fewer evaluations (Bayesian prior), so one lucky call can't max it.
  - **Consistency, 20%:** the share of positive daily evaluation periods.
  - **Risk management, 10%:** penalizes max drawdown and single-position concentration above 50%.
- **Community Contribution (0–100), 50% of the total:**
  - **Research quality, 40%:** published theses/briefs scored on structure: sources present, counterarguments, risks, invalidation filled, and length within sensible bounds. Near-duplicate text (normalized hash or shingle similarity against the user's own and others' posts) earns zero.
  - **Helpful feedback, 30%:** helpful minus not-helpful reactions, **weighted by rater diversity**: each rater counts at most once per author per day; raters with accounts under 24h or with no research of their own count at half weight; **reciprocal helpful rings** (A↔B mutual helpful votes above a threshold) are discounted. Demo accounts' votes count zero toward non-demo users.
  - **Educational, 20%:** learning notes and answers to questions that received helpful votes.
  - **Participation, 10%:** comments that received helpful votes, plus distinct active days. Capped.
- **Suiem Score** = 0.5 × investor + 0.5 × contribution, rounded half-even to 2 decimals using the decimal library (no floats in persisted values). Snapshots store every component, the inputs summary, the methodology version and maturity.
- **Never counted:** $WIF balances or votes (there is no FK and no code path), post counts, AI report counts, browsing time, follower counts, paid anything.
- **Maturity:** `building` means no score is shown, only "Building track record: X of 5 evaluated decisions, Y of 3 days, Z of 3 raters". `ranked` shows the score with its breakdown, the "Hackathon season · preview" badge, the methodology version and "Simulated / testnet performance".
- **Score card** (profile and hover): the total, the two components and their sub-components, maturity, evaluation period, methodology link, and "What changed" (the diff from the previous snapshot).
- **Methodology page** `/leaderboard/methodology`: formulas, weights, thresholds for `v1-hackathon` vs `v1`, benchmark disclosure, and the integrity rules ("votes and $WIF never affect the score", anti-manipulation measures). Also "The Suiem Score is not a prediction of future returns and not a financial rating."

### 4. Leaderboards `/leaderboard`

- **Opt-in only** (`appear_in_leaderboards`). Only `ranked` profiles appear. Every row shows its maturity and methodology version.
- Three boards:
  - **Suiem Score** (the 50/50 total)
  - **Research Contributors** (the contribution component only)
  - **Investors** (the investor component only, labelled "simulated / testnet")
- These boards are the **candidate pools for Sprint 7's weekly elections**, so expose `GET /leaderboards/:board?period=week`. Write a short note in the report on how Sprint 7 should draw nominations from them.

### 5. API (`/api/v1`, Zod, rate-limited, session auth; device tokens get 403 on all of these)

- `GET/PATCH /me/profile`
- `GET /profiles/:handle`, `GET /profiles/:handle/research`, `GET /profiles/:handle/portfolio` (only if permitted)
- `POST/DELETE /users/:id/follow`, `POST/DELETE /users/:id/mute`, `POST/DELETE /users/:id/block`
- `GET /feed?tab=following|discover&cursor=`
- `POST /posts`, `GET /posts/:id`, `DELETE /posts/:id` (soft)
- `POST /posts/:id/comments`, `POST /posts/:id/reactions`, `DELETE /posts/:id/reactions/:kind`, `POST/DELETE /posts/:id/bookmark`, `POST /posts/:id/report`
- `GET /notifications`, `POST /notifications/read`
- `GET /profiles/:handle/reputation`, `GET /reputation/methodology`, `POST /reputation/appeals`
- `GET /leaderboards/:board`

## P1: if time allows (cut in this order: last first)

1. Moderation queue `/moderation` (moderator role only): reports list, hide post/comment with a reason code, audit log entry, and the reporter is notified of the outcome.
2. Appeals: the user files a score appeal; a moderator marks it reviewed or recalculated. Recalculation re-runs the deterministic engine and records an audit entry.
3. Communities: seed one per sector (Technology, Semiconductors, Consumer, Energy, Finance, Crypto). Join/leave, and a community feed filter.
4. Bookmarks page.

## Tests (must pass)

- **Score engine (unit, pure):**
  - **Reproducibility:** recomputing the same evidence and version gives byte-identical snapshots.
  - **Property tests:** adding $WIF holdings or votes, post count, AI report count, follower count or browsing data changes **nothing**.
  - **One lucky trade:** a single huge winning trade can't produce a `ranked` profile or a max thesis score.
  - **Missing data:** missing or unverifiable data never increases the score.
  - **Rings:** a reciprocal helpful ring, plus a sockpuppet ring of new accounts with no research, are discounted.
  - **Duplicates:** near-duplicate posts score zero for quality.
  - **Building state:** `building` stores no score (the DB CHECK).
  - **Weights:** the 50/50 and sub-weights are exact on fixture data (worked examples in the test file).
- **Thesis evaluation:** uses the frozen v1 even after v2/v3 edits; benchmark-relative direction; append-only.
- **Privacy (integration, per field):** each private, followers or public setting is enforced on every endpoint that could leak it (profile, portfolio, feed, search, leaderboard). The wallet is never exposed by default. The portfolio snapshot contains percentages only.
- **Social:** block and mute rules; rate limits; no self-reaction; helpful/not-helpful exclusivity; soft delete hides content everywhere; notifications created; cursor pagination is stable.
- **XSS:** script, img onerror and javascript: URL payloads in posts, comments, bio and display name render inert (web component test plus an API round-trip).
- **No copy trading:** no API path from a follow, a portfolio view or "save portfolio" to an order (route scan + test).
- **Scoping:** user A can't edit B's profile, posts or settings. Device tokens get 403 on every new route.
- **Leaderboard:** opt-in only; building profiles excluded; demo accounts excluded by default.
- All existing checks stay green: typecheck, lint, format, depcruise, unit, integration, extension E2E, and Foundry.

## Hard rules

- The reputation code has **no** dependency on elections, $WIF, chain-write code or token balances (add a depcruise rule: `reputation-no-economy`).
- Never present simulated or testnet results as live verified performance.
- Nothing financial is public by default. No wallet exposure without consent.
- No trade from a like, follow, comment or portfolio view. Copy trading doesn't exist.
- No HTML rendering of user content.
- No Robinhood name or logo.

## Deliverables

- `docs/sprints/SPRINT_6.md`: what works and how to see it (manual demo with two browsers or users: publish thesis → share → second user follows, comments and marks helpful → thesis evaluates → score moves from building toward ranked → leaderboard), the test output, worked score examples, what was cut, and open questions.
- `docs/REPUTATION_METHODOLOGY.md` (the same content as the methodology page).
- Update `docs/HACKATHON_PLAN.md`.
- The note for Sprint 7: how election candidates are drawn from the leaderboards.

Finish with:
1. What works now
2. Test summary
3. What was cut
4. What I need for Sprint 7: a mainnet wallet with a little ETH on Robinhood Chain plus some real $WIF for test votes; an Alchemy key or private RPC URL for mainnet is recommended

Then STOP and wait for my approval before Sprint 7.
