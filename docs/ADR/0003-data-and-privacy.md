# ADR-0003: Data, privacy, financial data providers and portfolio visibility

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §5.3, §5.7, §6, §9.4, §14, §16.3–16.4, §18.2; **D-05, D-10**

## Context

An earlier prototype ran a content script on `<all_urls>`, tracks minutes per social site, uploads minute totals through an unauthenticated API, sends up to 12k characters of page text on Analyze, and loads remote fonts. Its prices come from an unlicensed Yahoo endpoint. The PRD requires local-first, consent-gated collection, a data inventory, retention, export/delete, and licensed data.

## Decision

### 1. Collection model

- Extension states are a state machine in the service worker: `ON`, `PAUSED{until}`, `OFF`, `PRIVATE{tab|site|session}`. On any non-ON state the worker **unregisters** dynamic content scripts, clears digest alarms and blocks outbound fetches at a single network gateway. Tests assert zero activity.
- Content scripts run only on sites the user has enabled through **optional host permissions**, or on the active tab when the user invokes research (`activeTab`). There is no static `<all_urls>` content script.
- What leaves the device: on explicit research requests only, `{entityId, sourceUrl, selectedExcerpt?}`, after a preview of the payload. Detection events stay local. Digest sync is opt-in and sends only digest-category items (§5.3), never raw URLs history beyond the items the user saw.
- Incognito: the extension is disabled by default (`incognito: "not_allowed"` until reviewed).
- No remote code, fonts or analytics in the extension. Telemetry is opt-in, aggregated and minimized (`/extension/telemetry`).

### 2. Storage, retention, rights

- Classes: P0 secrets (never stored), P1 sensitive personal/financial (encrypted columns, RLS), P2 personal (RLS), P3 public.
- Default retention: extension local summaries 30 days (user-configurable), synced digest 90 days, research briefs until deleted, audit and financial evidence per legal hold (append-only, anonymized on deletion).
- `GET /me/data-inventory`, export as JSON + CSV, delete with anonymization of append-only evidence, consent withdrawal. All are jobs with completion metrics (§2.4 trust metrics).
- Logs: an allowlist-based redactor. Raw page text, wallet secrets and private keys are never logged (§18.2).
- Nothing personal goes onchain. Contracts receive only addresses and IDs.

### 3. Financial data providers (D-05)

- Adapter interface `MarketDataProvider` (quotes, fundamentals, filings, news) with per-field provenance: provider, retrieved_at, as_of, period, unit, currency, kind (reported/estimated/calculated) and formula.
- Choosing a provider needs licence terms for display, caching, AI summarization and redistribution, plus coverage, latency and cost. Candidates are evaluated in OQ-PR-01. **No scraping** of unlicensed endpoints.
- SEC EDGAR (public filings) may serve as a no-licence-cost filings source, subject to fair-access rules. To be confirmed.
- Every displayed figure has a `dataFreshness` state. Stale or missing data is stated, never filled in.

### 4. Social portfolio visibility (D-10)

- Default **private** for portfolio, positions, transactions, thesis, research activity, follower list and leaderboard appearance.
- Visibility levels per field: private, followers, public. Public snapshots are **allocation percentages with a timestamp**, not quantities or wallet addresses, unless the user separately consents to "show wallet-linked holdings".
- Onchain caveat shown at consent: a linked wallet's holdings are already public onchain. Suiem will not link an address to a profile publicly without explicit consent.

## Consequences

- Detection works only on sites the user enables, so activation needs one extra permission prompt. This is intentional per §6.2.
- Licensed data costs are a business dependency for Phase 3/4.

## Open items

OQ-PR-01 (data provider), OQ-L-03 (browser-tracking and data-protection laws incl. India DPDP Act 2023), OQ-P-08 (default visibility levels), OQ-P-11 (retention defaults).
