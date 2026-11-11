# Sprint 6: Social + Reputation (backend)

- Date: 2026-11-11 · Branch: `hackathon/main` · Brief: `prompts/PHASE_6_PROMPT.md`
- Status: **backend complete (P0 and all P1 items), awaiting PO approval before Sprint 7.** Nothing pushed. No chain transactions. Worked in a single session with no subagents.
- **The web UI is deferred by PO instruction** ("build everything except UI; we will build it at last"). Only the plain-text renderer for user content and its XSS component test were built on the web side, because the brief requires that test.

## What works and how to see it

Everything is reachable through `/api/v1` (OpenAPI at `/api/v1/openapi.json`, regenerated). Start the stack as usual (`pnpm db:migrate && pnpm db:seed && pnpm dev`). The API now also runs the reputation jobs every 15 minutes (`REPUTATION_JOBS=inline`, the default).

### Demo script (two users; API calls the UI will make)

1. **User A publishes a thesis.**
   - `POST /theses` then `POST /theses/:id/publish {visibility:"public"}`.
   - v1 records the instrument price and **SPY** (Finnhub) at the moment it was written.
2. **A shares it.** `POST /posts {kind:"thesis", thesisId, body, visibility:"public"}`.
   - Visibility is required. A post can't be wider than its thesis.
   - Labels are set by the server: **Sourced** (evidence cited), **AI-assisted** (AI drafted for that company or cited brief), **Sponsored** (always false).
3. **User B engages.**
   - Follows: `POST /users/:A/follow` (A gets a `new_follower` notification).
   - Comments: `POST /posts/:id/comments`.
   - Marks the post helpful: `POST /posts/:id/reactions {kind:"helpful"}` (A gets `comment` and `helpful` notifications).
   - The post appears in B's `GET /feed?tab=following` and in `?tab=discover`.
4. **The thesis evaluates.** At the end of the horizon (as short as 1 day), the job evaluates the frozen v1 against SPY.
   - It writes an append-only `thesis_evaluations` row and a `reputation_evidence` row.
   - It sends A a `thesis_evaluated` notification and rescores A.
5. **A's score card:** `GET /profiles/A/reputation`.
   - `building` shows the progress ("X of 5 evaluated decisions, Y of 3 days, Z of 3 raters") and no score.
   - Once the thresholds are met it becomes `ranked`, with the total, both halves, eight components, the badge **"Hackathon season · limited history · preview"**, "Simulated / testnet performance, not live verified", the evaluation period, the methodology link and **What changed**.
6. **Leaderboard.** A opts in (`PATCH /me/profile {appearInLeaderboards:true}`), then `GET /leaderboards/suiem?period=week` lists A. The `research` and `investors` boards work the same way.
7. **Methodology:** `GET /reputation/methodology` serves the content of `docs/REPUTATION_METHODOLOGY.md`.

### Built (brief § → delivered)

| § | Delivered |
| --- | --- |
| Migration | `0006_social.sql`:<br>• tables: `mutes`, `blocks`, `comment_reactions`, `moderation_reports`, `benchmark_marks`, `thesis_evaluations` (append-only, v1 only), `reputation_appeals`, `notifications`<br>• `users.role` (+ `handle_changed_at`). The API role can update only `handle`, `display_name`, `status`, `handle_changed_at` (column privilege), so it can't touch `role` or `is_demo`. `is_demo` already existed.<br>• profiles: `theses_visibility`; `followers_visibility` now defaults to private<br>• posts: labels, server-built `attachment`, moderation hide, no default visibility, `sponsored` CHECK false, helpful/not-helpful exclusivity index<br>• snapshots: hash, previous link, append-only, a building snapshot has no totals.<br>`0007_communities.sql` seeds six sector communities. |
| 1 Profiles and privacy | `GET/PATCH /me/profile`: handle (validated, unique, changeable once), display name, bio and the seven per-field settings plus leaderboard appearance, all private by default. Turning on wallet visibility requires `acknowledgeOnchainPublicity`.<br>`GET /profiles/:handle` returns each field per its setting. Badges: "Demo account" and "Hackathon season". Someone who blocked you is a 404. The score card is shown to others only if the user opted in to leaderboards.<br>`GET /profiles/:handle/portfolio` returns **cost-basis percentages per book** with the book label and a timestamp. `positionsVisibility` adds held-since dates; `transactionsVisibility` adds side, instrument, book and date. No quantities, amounts or addresses.<br>`POST /profiles/:handle/portfolio/watchlist` (**Save portfolio**) creates a watchlist and never an order. |
| 2 Graph, posts, feed | • Follow, mute and block. Blocking removes follows both ways; a blocked user can't follow, comment on or react to the blocker.<br>• Post kinds: thesis, research brief, discussion, question, learning note, portfolio snapshot (percentages only, hidden again if the author's portfolio setting is narrowed).<br>• One level of replies; helpful/not-helpful on posts and comments; bookmarks (`GET /bookmarks`); reports.<br>• Rate limits: 10 posts/h, 30 comments/h, 50 helpful/day. No self-reactions.<br>• **Following:** keyset cursor. **Discover:** recency decay (24 h half-life), rater-weighted helpful score and a trending-company boost, at most 2 posts per author per page. The cursor holds a fixed `asOf` and page index, so pages are stable. `entityId` gives a company's Community tab and `community` the community feed.<br>• Muted, blocked, deleted, hidden and non-visible posts are excluded in SQL.<br>• Notifications: new follower, comment, reply, helpful (deduplicated), thesis evaluated, report outcome, appeal outcome. `GET /notifications` returns the unread count; `POST /notifications/read` clears it. |
| 3 Reputation engine | `workers/reputation` (`@suiem/reputation`):<br>• **pure** `score(evidence, methodology) → snapshot` in integer maths<br>• `evaluateThesis`<br>• the DB evidence collector<br>• jobs: SPY marks, due evaluations, snapshot on change, a loop at least hourly, and rescoring after each social action.<br>`v1-hackathon` and `v1` are both in code. Details: `docs/REPUTATION_METHODOLOGY.md`. |
| 4 Leaderboards | `GET /leaderboards/:board?period=week\|all&showDemo=`: boards `suiem`, `research` and `investors` (labelled "simulated / testnet"). Opt-in only, ranked only, demo accounts excluded by default. Every row carries maturity and methodology version. |
| 5 API | Every listed route, plus `GET /bookmarks`, `DELETE /comments/:id`, `POST /comments/:id/reactions`, `POST /comments/:id/report`. All are Zod-validated, rate-limited and session-only. Device tokens get 403 `DEVICE_SCOPE` on every one (tested by iterating the route registry). |
| P1 1 Moderation | `GET /moderation/reports` and `POST /moderation/reports/:id/resolve {hide\|dismiss, reason}`:<br>• moderator role only<br>• resolves every open report on the target<br>• hides with a reason code<br>• writes an audit log entry<br>• notifies reporters.<br>Moderators can't resolve reports about their own content. `pnpm user:role <handle> moderator` (owner DB connection, audited) is the only way to grant the role. |
| P1 2 Appeals | `POST /reputation/appeals` (one open at a time). `POST /moderation/appeals/:id/resolve {reviewed\|recalculate}` re-runs the deterministic engine and audits the before/after snapshot IDs. A moderator can't resolve their own appeal. |
| P1 3 Communities | Technology, Semiconductors, Consumer, Energy, Finance and Crypto, each mapped to registry sectors. Join and leave; posting in a community is members-only; `GET /feed?community=slug`. Membership is a feed filter only. |
| P1 4 Bookmarks | `GET /bookmarks` API (page deferred with the UI). |

## Test output (2026-11-11)

```text
$ pnpm typecheck              Tasks: 11 successful, 11 total
$ pnpm lint                   eslint . --max-warnings=0 (0 problems)
$ pnpm format:check           All matched files use Prettier code style!
$ pnpm depcruise              ✔ no dependency violations found (263 modules, 795 dependencies cruised)
$ pnpm test (unit)            Test Files 20 passed (20) · Tests 244 passed (244)
$ pnpm test:integration       Test Files 8 passed (8) · Tests 141 passed (141)
$ pnpm test:e2e:extension     10 passed (1.0m)
$ pnpm contracts:test         22 passed (VenueTest) + 1 invariant: 23 total
```

| Brief requirement | Where |
| --- | --- |
| Reproducibility (byte-identical, order-independent) | `workers/reputation/src/engine/score.test.ts › reproducibility` |
| Property tests: $WIF, posts, AI reports, followers, browsing change nothing | `› never counted` (fast-check, 100 runs) |
| One lucky trade can't rank; one lucky thesis can't max | `› one lucky trade` |
| Missing data never increases the score | `› missing or unverifiable data…` (incl. property test) |
| Reciprocal ring + sockpuppet ring discounted; rater research must predate the vote | `› rings and sockpuppets`, `› rater research must predate the vote` |
| Near-duplicates score zero (others' and own) | `› duplicates earn zero quality` |
| Building stores no score (engine + DB CHECK) | `› building state`; `packages/db/src/db.int.test.ts` |
| Exact 50/50 and sub-weights (worked example) | `› weights` |
| Thesis evaluation: frozen v1 after v2, SPY-relative, append-only | `apps/api/test/social.int.test.ts › thesis evaluation`; engine `› thesis evaluation (pure)` |
| Privacy per field × viewer (owner, follower, stranger, anonymous) on profile, research, portfolio; wallet never by default (also feed, leaderboard); percentages only | `social.int.test.ts › profiles and privacy` |
| Block, mute, rate limits, no self-reaction, exclusivity, soft delete, notifications, stable cursors + diversity cap | `social.int.test.ts › social graph…`, `social-limits.int.test.ts` |
| XSS (web component + API round-trip) | `apps/web/components/social/PlainText.test.tsx`; `social.int.test.ts › XSS` |
| No copy trading (route scan + test) | `social.int.test.ts › no copy trading` |
| Scoping; device tokens 403 on every new route | `› scoping`, `› device tokens…` |
| Leaderboard opt-in, building excluded, demo excluded by default | `› reputation and leaderboards` |
| Moderation, appeals, communities; the API role can't grant itself moderator | `› moderation, appeals and communities (P1)` |
| `reputation-no-economy` | `.dependency-cruiser.cjs` + `workers/reputation/src/engine/integrity.test.ts` (source scan) |

Worked score examples: `docs/REPUTATION_METHODOLOGY.md` §6 (= the `weights` test).

## Security review follow-ups (fixed this sprint)

1. **Theses could be cherry-picked or farmed.** Now only theses published within 24 h of being written count, at most one per company per day.
2. **Raters' "has research" was too easy to meet.** It now means *published* research before the vote.
3. **The duplicate corpus could miss originals.** It now covers every earlier item on the user's companies plus the most recent research across all companies.
4. **The AI-assisted label could be dodged.** The draft endpoint now marks the company and the brief for 30 days, and a thesis is labelled AI-assisted if either matches.
5. **A moderator could resolve reports about their own content.** That is now forbidden.

Found by tests:

- Discover pagination broke the per-author cap. Pages are now the capped pages themselves.
- Helpful notifications were duplicated when someone re-voted.
- An enum comparison bug in the portfolio snapshot.

## Deviations and decisions

| Item | What and why |
| --- | --- |
| UI | Deferred by PO instruction. Pages still to build: `/feed`, `/posts/[id]`, `/u/[handle]`, `/notifications`, `/leaderboard`, `/leaderboard/methodology`, Settings → Profile & privacy, the research Community tab, "Share to feed" on theses and briefs, `/moderation`, `/communities`, bookmarks. The API covers all of them. Render user text only with `components/social/PlainText`. |
| Score visibility | A score card is shown to other people only if the user opted in to leaderboards. It reveals investor-performance information, and "nothing financial is public by default". |
| Portfolio allocation basis | Share of **cost basis** within each book (no live quotes needed, deterministic), labelled as such. |
| Positions / transactions settings | `positions` adds held-since dates per allocation; `transactions` adds side, instrument, book and date. Never amounts. |
| Theses setting | New `theses_visibility` (the "thesis" field in the brief). A thesis is listed on the profile only if both it and its own visibility allow the viewer. |
| Risk-adjusted return | No free price history (Finnhub candles are premium), so the method is a chain-linked return of **closed trades** against SPY over each holding period, using hourly SPY marks the job records from now on. Trades without marks are excluded from risk-adjusted performance and consistency. They still count as decisions. |
| Evidence table | `reputation_evidence` (append-only) records immutable facts (thesis evaluations). The engine reads a typed evidence bundle collected fresh each run. |
| Wallet address format | Lowercase hex (the social module doesn't import viem, per `reputation-no-economy`). |
| `like` reaction | Still allowed by the 0001 CHECK, but the API accepts only `helpful` and `not_helpful`. |
| Search | No user or profile search exists yet. When one is added, it must reuse `allowed()` and `VISIBLE_POST_SQL`. |

## What was cut

- **All web UI pages** (PO instruction). Only the plain-text renderer was built.
- Nothing from the P0 or P1 backend lists was cut.

## Note for Sprint 7: drawing election candidates from the leaderboards

- **Candidate pool.** Each weekly election maps to one board:
  - "Research Contributor" uses `GET /leaderboards/research?period=week`.
  - "Investor" uses `GET /leaderboards/investors?period=week`.

  The `week` period lists opted-in, `ranked`, non-demo profiles that were active in the last 7 days.
- **Nominations.**
  - At election creation, snapshot the **top N (suggest 8)** rows into `election_candidates`, recording the board, rank, score and methodology version in `elections.rules`.
  - Store that frozen list. Never recompute candidates after voting opens.
  - Optionally allow a self-nomination post (`posts.kind = 'election_nomination'`) only from users already in the pool.
- **Eligibility at snapshot time:** `ranked`, `appear_in_leaderboards`, `status = 'active'`, not `is_demo` (unless it's a clearly labelled demo election), and no open moderation action against the user.
- **Separation (must hold):** election code reads leaderboards; reputation code never reads elections or $WIF. Keep `reputation-no-economy` and add the reverse note in the elections module. Votes and winners must never write to `reputation_*`. A win can appear on the profile as an achievement, but it is not score evidence.

## Open questions

- **OQ-S6-01:** should a user's score card be visible on their profile without opting in to leaderboards (today it is not)?
- **OQ-S6-02:** confirm the portfolio-snapshot basis (cost basis within each book) versus market value (needs quotes and is noisier).
- **OQ-S6-03:** Sprint 8 demo seeding. Demo accounts can be seeded with the `is_demo` flag and real-time evidence only (no backdating). They will stay `building` unless they really act over 3 days. Should the demo use one real multi-day account that started today?
