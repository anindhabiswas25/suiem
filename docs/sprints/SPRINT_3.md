# Sprint 3: Suiem Intelligence (browser extension)

- Date: 2026-11-11 · Branch: `hackathon/main` · Brief: `prompts/PHASE_3_PROMPT.md`
- Status: **complete, awaiting PO approval before Sprint 4.** Nothing pushed, no transactions, no deployments.

## What works and how to see it

### Manual demo (local)

```bash
docker compose up -d --wait && pnpm i && pnpm db:migrate && pnpm db:seed && pnpm dev
pnpm extension:build      # load apps/extension/.output/chrome-mv3 unpacked in chrome://extensions
```

1. **Sign in** at http://localhost:3000 (passkey or wallet) and finish onboarding. The extension step explains install and connect.
2. **Connect:** Settings → **Browser extension → Connect extension**. The code is handed to the extension (`externally_connectable`), its options page opens, and it shows **"This code belongs to @your_handle"**. Click **Yes, connect**.
3. **Grant a site:** Options → Sites → add `x.com` (Chrome asks for that one site only).
4. **Read a post on x.com** mentioning `$NVDA` or "Nvidia CEO Jensen Huang". A small **"NVIDIA detected"** toast appears once, bottom right. A post about apple pie shows nothing.
5. **Research:** click the toast's **Research** button. The side panel shows the company card, why it was detected, and the instruments (`TEST:…`, "Testnet · no value"). **Request AI research** previews the exact JSON; **Confirm and send** queues it and links to `/research/ent:nvidia` in the web app.
6. **Add to watchlist** → visible on the web **Watchlist** page.
7. **Control:** the popup's big ON/OFF toggle, pause (30 min / 1 h / until tomorrow / custom) and Private (this tab / this site / session). In OFF or PAUSED nothing runs and nothing is sent.
8. **Digest:** Options → Daily digest (local only). It lists only what you did, says why for each item, and supports delete one / delete all.
9. **Revoke:** web Settings → Revoke. The extension's next request is refused.

`apps/extension/e2e/devstack-check.ts` automates steps 1–2 and 6–9 against the running dev stack, including one-click pairing over `externally_connectable` (run on 2026-11-11: `DEVSTACK OK`).

### Judges

`pnpm extension:zip` → `apps/extension/.output/suiem-extension-0.3.0-chrome.zip` (load unpacked). The README explains every permission.

## Built

| Brief § | Delivered |
| --- | --- |
| 1 Entity dictionary | `packages/shared/src/entities/dictionary.ts`: 40 entities (the 5 testnet Stock Token names, NVDA/AAPL/MSFT/GOOGL/META, crypto, index, funds) with legal names, tickers, cashtags, exchange symbols, and per-alias `ambiguous` (Apple, Meta, Amazon, ON, ALL, IT, Arm, …). The DB seed imports it (single source). |
| 2 Detector | `detector.ts`: pure, no I/O. Cashtags/legal names score high; ambiguous words need financial context; "my Tesla" and "Apple pie" are capped; crypto/index/fund are typed; output follows `detectionSchema` with a SHA-256 span hash (never text). Threshold 0.8. **46-case corpus.** |
| 3 Extension | WXT MV3 + React. Service-worker state machine (`core/state.ts`) applied by `core/gate.ts`: unregister scripts, clear alarms, block the gateway. `core/net.ts` is the only `fetch` (ESLint rule, demonstrated). Runtime-registered content script, toast in a closed shadow root (Research / Save for later / Dismiss / Mute company / Mute site). Rate limits 1 per entity per 30 min, 3 per site per hour. Popup, options, side panel, context menu, local digest with delivery alarm and retention purge. Permissions exactly as the brief lists; `incognito: not_allowed`; strict CSP; `externally_connectable` = web origin; stable ID via public key. |
| 4 Pairing | 5-min single-use hashed codes; hashed, revocable device tokens; web Settings list/revoke; migration **0003_extension.sql** (see deviations). |
| 5 API | `GET /extension/config`, `POST/GET/DELETE /extension/installations`, `POST /extension/pairing-codes`, `POST /extension/research-context`, `DELETE /extension/activity`, `GET /entities/search`, `GET /entities/:id`, `GET /entities/:id/instruments`, `GET /watchlists/default`, `POST /watchlists/default/items`, `GET /research/requests`. Device tokens get 403 `DEVICE_SCOPE` everywhere else. Redaction strips URL query strings and tokens. |
| 6 Web | Settings → Browser extension (connect / list / revoke), `/research/[entityId]` (entity, instruments with badges, queued requests), real Watchlist page, onboarding extension step with instructions. |

## Test output (2026-11-11)

```text
$ pnpm typecheck
 Tasks:    10 successful, 10 total

$ pnpm lint
eslint: 0 problems

$ pnpm format:check
All matched files use Prettier code style!

$ pnpm depcruise
✔ no dependency violations found (182 modules, 402 dependencies cruised)

$ pnpm test   (unit)
 Test Files  13 passed (13)
      Tests  130 passed (130)

$ pnpm test:integration   (Testcontainers Postgres 16 + Redis)
 Test Files  4 passed (4)
      Tests  68 passed (68)

$ pnpm test:e2e:extension   (Playwright + built extension + real API)
  ✓   1 › 0. connect to a Suiem account (pairing with handle confirmation) and grant a site
  ✓   2 › 1. detection ON: $NVDA shows exactly one notification, not again within the window
  ✓   3 › 2. an 'Apple pie' page shows no notification
  ✓   4 › 3. OFF: zero content-script executions, zero registered scripts, zero network, zero alarms
  ✓   5 › 3. PAUSED: zero content-script executions, zero registered scripts, zero network, zero alarms
  ✓   6 › 4. PRIVATE site: no detection and no digest entry
  ✓   7 › 5. highlighting sends nothing; research sends only the previewed fields after confirmation
  ✓   8 › 6. removing a site's permission stops detection immediately
  ✓   9 › 7. the digest shows only intentional actions; delete all empties it
  ✓  10 › 8. revoking the extension in web Settings takes effect immediately
  10 passed (43.0s)

$ pnpm contracts:build
Nothing to compile
```

How the E2E measures the brief's assertions:

- **Network:** a counting proxy sits in front of the real API, and every extension request is logged.
- **Content-script executions:** counted from CDP `Runtime.executionContextCreated` events for the extension's isolated world.
- **Registered scripts and alarms:** read via `chrome.scripting.getRegisteredContentScripts()` and `chrome.alarms.getAll()` in the service worker.
- **Research request:** the confirmed payload must deep-equal the on-screen preview, with the page's query string stripped and no cookie sent.

| Brief requirement | Test |
| --- | --- |
| Detector corpus (ambiguous never notify; clear mentions do) | `packages/shared/src/entities/detector.test.ts` (46 cases + output/dictionary tests) |
| State machine: every transition, pause expiry, private tab/site/session | `apps/extension/src/core/core.test.ts` (15 tests incl. rate limits and digest) |
| E2E 1–7 | `apps/extension/e2e/extension.spec.ts` (table above) |
| Pairing code single use + expiry | `extension.int.test.ts › a pairing code works once, and only for 5 minutes` |
| Device token scoped (403 elsewhere) | `› is rejected with 403 on every non-extension route` (12 routes) |
| Revoked token rejected | `› an extension can only disconnect itself; a revoked token is rejected immediately` + E2E 8 |
| research-context needs `userConfirmed` | `› research-context requires userConfirmed and stores exactly the confirmed fields` |
| Watchlist add idempotent | `› watchlist add is idempotent per item and visible on the web` |
| No excerpts / query strings / tokens in logs | `› logs never contain excerpts, URL query strings or tokens` + `redact.test.ts` |
| Extension imports no chain code; only `net.ts` fetches | depcruise `extension-no-chain` and ESLint `no-restricted-globals` (both demonstrated failing on a probe file, then removed) |

## Security review follow-ups (fixed this sprint)

1. **Pairing-code phishing:** the extension shows the target `@handle` and stores the token only after confirmation; cancel revokes it. `EXTENSION_ID` is required in production and pairing/writes must come from that extension origin.
2. **Disconnect could fail open:** revocation bypasses the privacy gate (it carries no browsing data), and failures are reported instead of silently dropping the token.
3. **Token readable by content scripts:** the device token moved from `chrome.storage.local` to the extension origin's IndexedDB. Session storage is locked to trusted contexts.
4. **Legacy token import could fixate an attacker's token:** the legacy key is now only deleted, never imported.

## Deviations and decisions

| Item | What and why |
| --- | --- |
| Migration name | `0003_extension.sql` (the brief says `0002_extension`; 0002 was already used by the app-role migration). |
| Pause expiry has no alarm | So PAUSED really has **zero alarms** (E2E-asserted), resume is checked on tab activity, startup and any extension message. Detection resumes at the first tab activity after the pause ends. |
| Origin check for GETs | Chrome omits `Origin` on GETs from extension pages. GETs may lack Origin but a wrong one is rejected; writes always require the extension origin (`extension.int.test.ts › extension origin check`). |
| E2E build differences | `SUIEM_E2E=1` grants the local fixture host and `notifications` statically (Chrome's permission prompt can't be clicked by automation), and opens the toast's shadow root so Playwright can click it. Production builds use optional host permissions and a closed shadow root. |
| "Revoking a site permission" in E2E | Exercised through Options → Remove (which calls `chrome.permissions.remove` and unregisters scripts). The real `chrome.permissions.onRemoved` path (revoking in `chrome://extensions`) calls the same `refresh()`, but the E2E host is a required permission in the test build, so Chrome won't remove it. |
| Side panel in E2E | Opened as a tab page (`sidepanel.html?tab=<id>`) because headless Chromium has no side-panel UI. The real toast → `chrome.sidePanel.open` path is wired and used in the manual demo. |
| Detection on real x.com | Verified against fixture pages that copy X's DOM (`data-testid="tweetText"`), not against live x.com (needs a logged-in account). Manual check recommended during the demo recording. |
| Digest sync | Out of scope (labelled "local only"), as briefed. |

## Open questions (added to `docs/decisions/OPEN_QUESTIONS.md`)

- **OQ-H-07:** distribution for judges (unpacked zip, or a Chrome Web Store "unlisted" listing, which needs a developer account and review time).
- **OQ-H-08:** x.com markup can change; the detector falls back to `article`/`p` text if `tweetText` disappears. Re-check on demo day.
