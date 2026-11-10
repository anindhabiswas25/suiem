# ADR-0007: Mobile strategy

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §20.1, §20.3; **D-11**

## Context

The PRD's current direction is responsive web first. The extension is desktop-Chromium only. Banchor notes that phone screen-time access is restricted, which is not relevant to Suiem since it does not track time.

## Decision

- Responsive web app (mobile breakpoints first-class, touch targets ≥ 44 px) plus an installable **PWA** with web push for opted-in notifications.
- Passkeys work on mobile browsers, so smart-account signing is available on mobile web (subject to the ADR-0002 spike).
- Native apps are deferred. Revisit after Phase 8 using beta data (mobile share, push needs, app-store policy for crypto/finance apps).
- No mobile equivalent of the extension. Mobile discovery uses share-to-Suiem (Web Share Target) for user-chosen links only.

## Consequences

One codebase for web. App-store financial-app review is avoided during testnet.

## Open items

OQ-P-09 (native app need and timing).
