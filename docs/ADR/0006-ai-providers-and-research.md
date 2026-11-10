# ADR-0006: AI providers and research orchestration

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §7; **D-07**

## Context

Banchor sends page text to a single OpenRouter model and returns buy picks. It caches results by URL across users and cites nothing. The PRD requires cited, schema-validated research, separation from execution, injection resistance, and no single-provider dependency.

## Decision

1. **Deterministic pipeline** (BullMQ flow) in `workers/research`: resolve entity → retrieve licensed facts/filings/news → normalize facts (with units, period, provenance) → generate structured sections → **validate** (Zod schema v1; every claim ID maps to ≥1 retrieved source; numbers in text must match normalized facts) → persist with `model`, `provider`, `prompt_template_version`, `schema_version`. LangGraph is optional and only for follow-up Q&A branching.
2. **Model-agnostic gateway** (`LlmProvider` interface) with at least two providers configured for failover. Region and data-retention terms are recorded per provider. No PII, wallet data or user notes go into prompts unless the user explicitly includes their own notes.
3. **Injection defence:** page and retrieved text is wrapped as delimited data with an explicit "data, not instructions" system policy. No tool use that acts. Output is constrained to the schema. A test corpus of known injection payloads runs in CI. Caches are keyed by `(entityId, sourceSetHash, schemaVersion)` and **never by a user-supplied URL plus text** (fixes Banchor R-4). User-supplied excerpts are cached per user only.
4. **Content policy:** no buy/sell/hold signals, price targets, "guaranteed" or "risk-free" language, or personalized recommendations. Bear case and risks are always present. A post-generation lint rejects outputs that break these rules.
5. **Isolation:** separate process and DB role. No imports of `packages/chain` writers or the order module (CI rule).
6. **Cost control:** per-user and per-day job quotas, provider spend caps, and a timeout per step.

## Consequences

Research is slower than a single prompt but auditable and reproducible. Provider choice is a commercial decision with no code impact.

## Open items

OQ-PR-02 (LLM providers, data terms, region), OQ-L-04 (research publishing / financial-promotion rules).
