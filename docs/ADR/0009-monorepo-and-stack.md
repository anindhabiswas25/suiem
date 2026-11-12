# ADR-0009: Monorepo layout and technology stack

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §13.1–13.2, §0.3 (layout + migration plan)

## Decision

Confirm PRD §13.2 with these specifics (full table in ARCHITECTURE §7, layout in §9):

| PRD suggestion | Decision | Note |
| --- | --- | --- |
| Next.js + TS | Confirmed | Exact version pins. App Router |
| MV3 + TS/React | Confirmed, built with **WXT** (Vite) | Typed manifest, side panel, dynamic content-script registration |
| NestJS or equivalent | **NestJS** on Fastify | Module per domain = modular monolith |
| PostgreSQL | Confirmed, PG 16 + **Drizzle** migrations | `numeric(78,0)` amounts, RLS |
| Redis + BullMQ | Confirmed | Research, digest, notifications, reputation jobs |
| LangGraph or deterministic | Deterministic BullMQ flows. LangGraph optional | ADR-0006 |
| Solidity + Foundry | Confirmed. OZ 5 via forge libs (not npm) | Slither + Aderyn in CI |
| viem **or** ethers | **viem**, everywhere | Typed ABIs, native ERC-4337 helpers, small bundle for extension. One encoding path |
| Event indexer | Custom worker on viem (ADR-0002/0005) | Small contract set. Avoids an external indexer as a correctness dependency (§2.2). Ponder can be reconsidered if scale demands |
| OpenTelemetry | Confirmed | Collector-agnostic |
| Encrypted object storage | S3-compatible with SSE + per-object keys | User-approved uploads only |
| REST v1, GraphQL if justified | REST `/api/v1` with OpenAPI from Zod | No GraphQL |

Tooling: pnpm workspaces, Turborepo, Vitest, Playwright, Testcontainers, anvil, Biome or ESLint + Prettier (ESLint chosen for dependency-boundary plugins), dependency-cruiser, Renovate, Gitleaks, osv-scanner, CodeQL.

Migration plan: none needed; Suiem is a fresh codebase.

## Consequences

The TypeScript-everywhere stack lets Zod schemas be shared across extension, web, API and workers. NestJS adds some boilerplate but makes domain boundaries and guards explicit.

## Open items

OQ-S-01 (hosting/cloud and secret manager), OQ-P-06 (team size / ownership per package).
