# workers/research

The AI research pipeline (PRD §7.5). Library code imported by the API, plus a BullMQ worker.

| Step | Code |
| --- | --- |
| 1. Resolve entity → ticker, CIK | `pipeline.ts › resolveEntity` (CIKs from `packages/shared/src/entities/cik-map.ts`) |
| 2. Retrieve | `providers/edgar.ts` (companyfacts, submissions), `providers/finnhub.ts` (profile, quote, peers, metrics, 30-day news ≤ 8). Timeouts, retry with backoff on 429/5xx, throttling, public-data cache (`research_source_cache`) |
| 3. Normalize | `figures.ts`: revenue, gross profit/margin, operating income, net income, operating cash flow, cash, debt, YoY growth, computed with bigint from the latest annual filing, each with period, as-of date, basis and formula. Valuation figures exactly as Finnhub publishes them |
| 4. Source pack | `sourcepack.ts`: numbered `s1…sN` (financials, filings, profile, market, news) |
| 5. Generate | `models/groq.ts` (strict structured outputs), `models/gemini.ts` (responseSchema), prompt `research.v1` in `prompt.ts`; untrusted data in sealed `<untrusted_data>` blocks |
| 6. Validate | `guard.ts`: numeric guard, `researchBriefV1` (citations, unknown sources, required sections), forbidden phrases, prompt-leak check. Retry once with the error list, then fall back |
| 7. Persist | `pipeline.ts › processRequest` writes `research_briefs` + `brief_sources`, completes the request. Quota (`quota.ts`) and the 12 h public-only cache live here too |

Follow-up answers and thesis drafts: `followups.ts`. Deterministic comparison: `compare.ts`.

## Running

- The API runs the worker in-process by default (`RESEARCH_WORKER=inline`). For a separate process set `RESEARCH_WORKER=off` on the API and run `pnpm --filter @suiem/research start`.
- Live smoke (real keys, manual, never CI): `pnpm research:smoke ent:nvidia [--only=gemini]`. Prints only status, model, counts.
- Re-record offline fixtures: `pnpm --filter @suiem/research record-fixtures` (needs `SEC_USER_AGENT`, `FINNHUB_API_KEY`).

Dependency rule: must never import chain code (`research-no-chain-*`).
