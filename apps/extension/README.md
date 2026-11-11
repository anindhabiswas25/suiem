# Suiem Intelligence (browser extension)

Notices companies on sites **you choose** and offers research **when you ask**. It never buys anything, never uploads your browsing history, and sends nothing without your action.

> Suiem is not affiliated with Robinhood Markets, Inc.

Chrome / Chromium, Manifest V3, built with WXT + React + TypeScript.

## Install

**From the release zip (judges):**

1. Download `suiem-extension-0.3.0-chrome.zip` and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the unzipped folder.

**From source:**

```bash
pnpm i
pnpm extension:build      # → apps/extension/.output/chrome-mv3 (load this folder unpacked)
pnpm extension:zip        # → apps/extension/.output/suiem-extension-0.3.0-chrome.zip
```

The build targets the Suiem web app at `SUIEM_WEB_ORIGIN` (default `http://localhost:3000`) and its API at `SUIEM_API_BASE` (default `<web origin>/api/v1`). For a hosted deploy, build with e.g. `SUIEM_WEB_ORIGIN=https://app.example pnpm extension:build`. No secrets are bundled.

The manifest carries a public key, so the extension ID is always `cpgeijpinjipcioicabhgfmcbacdkmcj`. Set `EXTENSION_ID` to this value on the API (required in production) so only this extension can pair.

## Connect to your Suiem account

1. Sign in to Suiem → **Settings → Browser extension → Connect extension**.
2. With the extension installed, the one-time code is handed to it automatically and its options page opens. Otherwise, copy the code (valid **5 minutes, single use**) into **Options → Account**.
3. The extension shows **which account the code belongs to** (`@handle`). Click **Yes, connect** only if it's yours.

The extension receives a **device token** that only works on extension endpoints. It cannot touch wallets, orders or your profile. It's stored in the extension's own IndexedDB, which content scripts can't read. Revoke it any time in **web Settings** (immediate) or **Options → Disconnect**.

## Permissions, one by one

| Permission | Why | When it is used |
| --- | --- | --- |
| `storage` | Your settings, the local digest and rate-limit history | Always local |
| `activeTab` | Lets the popup see which tab you're on, for "Private: this tab / this site" | Only when you click the toolbar icon |
| `contextMenus` | "Research selected company with Suiem" on selected text | Only while ON. Opening it sends nothing |
| `sidePanel` | The research panel | When you open it |
| `scripting` | Registers the detector **only** on sites you granted, and unregisters it when OFF / PAUSED / PRIVATE | The real on/off switch |
| `alarms` | The daily digest reminder | Only if you enable the digest, and only while ON |
| `notifications` (optional) | "Your Suiem digest is ready" | Requested when you enable the digest |
| Host: Suiem API origin | Talk to your Suiem account | Only after an explicit action (research request, watchlist add), plus the pairing exchange |
| Optional hosts: `x.com`, `twitter.com`, any site you add | Run the detector there | Granted one site at a time in **Options → Sites**. Removing a site revokes it immediately |

Not requested: `tabs`, `history`, `webRequest`, `cookies`, `<all_urls>`. Incognito is not allowed. There's no remote code, no remote fonts and no analytics.

## Privacy states

| State | What happens |
| --- | --- |
| **ON** | The detector runs on granted sites. Matching happens **on your device**; only a hash of the matched words ever leaves the page, and only to the extension's own worker |
| **PAUSED** (30 min / 1 h / until tomorrow / custom) | Content scripts unregistered, alarms cleared, the network gateway refuses every request. Resumes on the next tab activity after the pause ends |
| **OFF** | Same as paused, until you turn it back on |
| **PRIVATE: tab / site / session** | That tab, site or the whole browser session is excluded: no detection, no digest entries. Private session ends when the browser restarts |

Tested: in OFF and PAUSED, Playwright observes **zero** content-script executions, **zero** registered content scripts, **zero** extension network requests and **zero** alarms while browsing (`e2e/extension.spec.ts`).

## How detection behaves

- Cashtags (`$NVDA`), full names (`Nvidia`, `NVIDIA Corporation`) and exchange symbols notify at ≥ 80% confidence (configurable).
- Ordinary-word names and ticker collisions (Apple, Meta, Amazon, ON, ALL, IT…) stay silent unless financial context ("shares", "earnings", "CEO"…) supports them. "Apple pie" and "my Tesla" never notify.
- At most one notification per company per 30 minutes and 3 per site per hour. Dismissing records nothing.
- Highlighting text sends nothing. **Request AI research** shows exactly what will be sent (company, page address without its query string, and your selected text only if you tick it) and sends it only after you confirm.

## Daily digest (local only)

Built only from things you chose to do: companies you acted on, research panels opened, research requested, watchlist adds, "save for later". Each item says why it's there. Delete one item or everything. It's never uploaded.

## Development

```bash
pnpm --filter @suiem/extension dev          # WXT dev mode
pnpm --filter @suiem/extension typecheck
pnpm test:e2e:extension                     # Playwright: builds the E2E variant, starts Postgres/Redis containers,
                                            # local anvils, the real API and a counting proxy
pnpm --filter @suiem/extension exec tsx e2e/devstack-check.ts   # against a running `pnpm dev`
```

Code map: `src/core/state.ts` (privacy state machine), `src/core/gate.ts` (applies the state to scripts/alarms), `src/core/net.ts` (**the only module allowed to call `fetch`**, enforced by ESLint), `src/entrypoints/detector.content.ts`, `background.ts`, `popup/`, `options/`, `sidepanel/`. The detector and dictionary live in `@suiem/shared/entities`.
