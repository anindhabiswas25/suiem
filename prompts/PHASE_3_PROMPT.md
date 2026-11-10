You are the staff engineer for Suiem. Sprint 2 (foundation + app shell) is DONE and APPROVED. A cleanup commit also landed: stale compiled `.js` files, unused worker placeholders and the OTP/dual-control error codes were removed. All checks pass.

This is **SPRINT 3 of 8: Suiem Intelligence (browser extension)**, budget about 6 hours. This is the world is flat hackathon build. **Submissions close 12 Nov 2026, 17:30 UTC.** Build the thinnest version that works for real. Production hardening is deferred (ADR-0010).

## Read first

- `docs/HACKATHON_PLAN.md`
- `docs/sprints/SPRINT_2.md`
- ADR-0003 (data and privacy, extension collection model) and ADR-0010
- PRD §5.2 (X discovery flow), §5.3 (digest), §5.7 (privacy and control), §6.1–§6.7 (extension requirements and acceptance criteria), Appendix A items 4–7
- `packages/shared/src/extension/messages.ts`, `packages/shared/src/research/brief.ts`, `packages/db/src/seed-data.ts`, and `.dependency-cruiser.cjs`

Work on branch `hackathon/main`. Make small conventional commits. Do not push.

## Goal of this sprint

A user installs the Suiem extension and connects it to their Suiem account. They control it (ON / PAUSED / OFF / PRIVATE). They read a post on X mentioning NVIDIA, see one small dismissible "NVIDIA detected" notification, open the side panel and see the company card, and explicitly request research. They save the company to their watchlist, and see it in a local daily digest. **Nothing is ever bought, and nothing is sent without a user action.**

## Build

### 1. Entity dictionary (single source)

Move the seed entity list into `packages/shared/src/entities/`: canonical ID (`ent:…`), name, legal name, aliases, tickers/cashtags, exchange-qualified symbols, entity type (company / product / fund / index / crypto), and an `ambiguous` flag per alias. Both `packages/db` seed and the extension import it.

Expand it to about 40 well-known companies, including the 5 testnet Stock Token names (TSLA, AMZN, PLTR, NFLX, AMD) plus NVDA, AAPL, MSFT, GOOGL, META. Mark ordinary-word aliases as ambiguous ("Apple", "Meta", "Amazon" alone, "ON", "ALL", "IT"). No network I/O in this package.

### 2. Detector (pure, unit-tested, in `packages/shared`)

Input is text and a domain. Output follows PRD §6.3 and `detectionSchema`: entityId, candidate tickers, confidence, context category, an evidence span **hash** (never the text), timestamp, and ambiguity reason.

- Cashtags (`$NVDA`) and full names score high.
- Ambiguous words need supporting context (a ticker, "stock", "shares", "earnings", "CEO", "Inc.", etc.) or they stay silent or "possible match".
- Cryptos, indexes and funds are typed, not treated as companies.
- Notifications only fire at or above a threshold (default 0.8).

Include a test corpus of at least 40 cases, covering at least: "Apple pie recipe", "meta-analysis", "$ON sale", "the market is up", "I love my Tesla" (product, not company), "$NVDA earnings beat", and "Nvidia CEO Jensen Huang".

### 3. Extension app (`apps/extension`, WXT + React + TypeScript, MV3)

- **Manifest permissions:** `storage`, `activeTab`, `contextMenus`, `sidePanel`, `scripting`, `alarms` (only used when the digest is enabled). `optional_host_permissions`: `https://x.com/*`, `https://twitter.com/*`, plus user-added sites. **No static `<all_urls>` content script.** `incognito: "not_allowed"`. Strict CSP, no remote code, fonts or analytics. `externally_connectable` only for the Suiem web origin (from env at build time).
- **Service worker = the state machine:** `on`, `paused{until}` (30m / 1h / until tomorrow / custom), `off`, `private{tab|site|session}`. On any non-`on` state it **unregisters dynamic content scripts** (`chrome.scripting.unregisterContentScripts`), clears alarms, and the single network gateway (`net.ts`, the only module allowed to call `fetch`; add a lint/depcruise rule) refuses every request. When a pause expires, the worker restores `on` and re-registers the scripts.
- **Content script** (registered dynamically, only on granted sites): reads visible post text locally, runs the detector, and sends only `detection` messages (no text) to the worker. It renders a small, dismissible toast in a closed shadow root (no modal, no takeover). Toast actions: "Research", "Save for later", "Dismiss", "Mute company", "Mute site". Rate limit: at most once per entity per 30 minutes, and at most 3 per domain per hour (configurable). Dismissing records no intent. **A content script has no path to orders, wallets or any API** (it only messages the worker).
- **Popup:** a big ON/OFF toggle, pause options, a Private Mode button for the current tab/site, status text with icon (not colour alone), and links to options and the side panel.
- **Options page:** granted sites (add/remove, using `chrome.permissions.request`/`remove`, reflected immediately), muted companies/sites, notification threshold, digest settings (enable, delivery time, timezone, retention default 30 days), "Delete all local activity", and account connection.
- **Side panel** (opens from toast, popup, or the context menu "Research selected company with Suiem"):
  - The company card from the dictionary: name, tickers, type, and why it was detected.
  - "Instruments" from the API (`GET /api/v1/entities/:id/instruments`), showing a network badge and "Testnet · no value" or "Simulated" labels. No buy button in the extension.
  - **"Request AI research"** shows a preview of exactly what will be sent (`entityId`, `sourceUrl`, and the selected excerpt only if the user ticks "include my selected text"), then calls `POST /api/v1/extension/research-context` with `userConfirmed: true`. Sprint 4 builds the brief generator, so for now the API stores a `research_requests` row (status `queued`) and the panel shows "Queued. Your brief will appear in Suiem Research" with a link to the web `/research/[entityId]`.
  - **"Add to watchlist"** calls the existing tables through a new `POST /api/v1/watchlists/default/items`.
  - **"Open in Suiem"** links to the web app.
  - **Highlighting text never sends anything.** The context menu only opens the panel, pre-filled.
- **Daily digest (local only):** stored in `chrome.storage.local`, built only from intentional actions grouped per PRD §5.3: companies detected and acknowledged, research panels opened, research requested, watchlist adds. Not passive time. "Why it appeared" is shown on each item. Delete one item or all. An independent enable toggle. A delivery-time alarm that shows a Chrome notification "Your Suiem digest is ready", only when enabled and `on`. Retention purge runs on startup and alarm. Sync to the account is OUT of scope (label it "local only").

### 4. Account connection (pairing)

- Web `Settings → Extension → Connect`: a logged-in user gets a one-time pairing code (random, 5-minute TTL, single use). It is sent to the extension via `chrome.runtime.sendMessage(EXTENSION_ID, …)` (externally_connectable), with a manual copy/paste fallback.
- The extension exchanges it at `POST /api/v1/extension/installations` for a **device token** (random, stored hashed in the DB, revocable, scoped to extension endpoints only, so it cannot call wallet or order routes).
- Web Settings lists connected extensions and can revoke them. Revocation takes effect immediately.
- Migration `0002_extension.sql`: `extension_installations` (user, token hash, created, last_seen, revoked_at), `extension_pairing_codes`, `research_requests` (user, entity, source_url, excerpt nullable, status, created_at). Grant the `suiem_app` role least privilege, as in 0001.

### 5. API additions

All under `/api/v1`, Zod-validated, rate-limited, and mounted only for the device token or the session as appropriate:

- `GET /extension/config` (thresholds, rate limits, dictionary version)
- `POST /extension/installations`
- `DELETE /extension/installations/:id`
- `POST /extension/research-context`
- `DELETE /extension/activity` (deletes this user's research_requests)
- `GET /entities/search`
- `GET /entities/:id`
- `GET /entities/:id/instruments`
- `POST /watchlists/default/items`

Device-token requests to any non-extension route return 403 (test). Logs never contain excerpts, URLs' query strings or tokens (extend the redaction allowlist and its test).

### 6. Web app touches

- Settings → Extension (connect, list, revoke)
- `/research/[entityId]` page showing the entity, instruments with network badges, and queued research requests ("brief coming in Sprint 4")
- The onboarding "extension offer" step links to the install/connect instructions

## Tests (automated, must pass)

- **Detector corpus:** ambiguous/ordinary words never reach notify confidence. Clear mentions do.
- **State machine unit tests:** every transition, pause expiry, and private tab/site/session.
- **Playwright extension E2E** (Chromium persistent context loading the built unpacked extension, with local fixture pages served by the test that imitate an X post, using a test host the extension is granted):
  1. Detection ON shows a notification exactly once for `$NVDA`, and not again within the window.
  2. An "Apple pie" page shows no notification.
  3. **OFF and PAUSED: zero content-script executions, zero registered content scripts, zero extension network requests, zero alarms** while scripted browsing runs (assert via a CDP network log, `chrome.scripting.getRegisteredContentScripts`, and `chrome.alarms.getAll`).
  4. PRIVATE site gives no detection and no digest entry.
  5. Highlighting text sends no request. Research request sends only the previewed fields after confirmation.
  6. Revoking a site permission stops detection immediately.
  7. Digest shows only intentional actions. Delete all empties it.
- **API integration:** pairing code single-use and expiry; device token scoped (403 elsewhere); revoked token rejected; research-context rejects missing `userConfirmed`; watchlist add idempotent per item.
- **Dependency rules:** the extension imports neither `@suiem/chain` nor viem/wagmi. Only `net.ts` calls `fetch`.
- All existing checks remain green: typecheck, lint, format, depcruise, unit, integration.

## Hard rules

- No buy, order, wallet or signing code anywhere in the extension.
- Nothing leaves the device without an explicit user action, except the pairing exchange and the config fetch while `on`.
- No raw browsing history, no page text uploads by default, and no telemetry.
- OFF/PAUSED gate the real work, not just the UI.
- Don't use Robinhood's name or logo in the extension (name "Suiem", our wordmark icon). Add "Not affiliated with Robinhood Markets, Inc." on the options page.
- Don't invent instrument addresses (registry rows stay `UNVERIFIED` until Sprint 5).
- No secrets in the bundle.
- Don't copy Banchor code (the reference clone was deleted; the audit lives in docs).

## Deliverables

- `apps/extension` builds (`pnpm --filter @suiem/extension build`) to a loadable unpacked folder, and has a zip script for judges.
- `apps/extension/README.md`: install, connect, permissions explained one by one (PRD §5.1 step 11), and the privacy states.
- `docs/sprints/SPRINT_3.md`: what works and how to see it (step-by-step manual demo on x.com), test output summary, deviations, and open questions.
- Update `docs/HACKATHON_PLAN.md` status.

Finish with:
1. What works now
2. Test summary (paste the outputs)
3. Anything skipped
4. What I need to prepare for Sprint 4: the Anthropic API key, and which news/financial data source to use (recommend free options plus SEC EDGAR, with their limits)

Then STOP and wait for my approval before Sprint 4.
