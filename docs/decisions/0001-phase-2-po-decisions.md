# Decision 0001: Product-owner decisions for Phase 2

Date: 2026-11-10 · Source: Phase 2 brief (`prompts/PHASE_2_PROMPT.md`), product owner.

| ID | Decision | Engineering consequence |
| --- | --- | --- |
| OQ-P-13 | **Approved.** Suiem never integrates Banchor's growth loops (scroll-to-buy, scroll dividends, detox auto-buy, highlight auto-execution, one-tap copy mirroring), including future "opt-in" variants | ADR-0001 §3–4 are permanent product constraints, not phase-scoped |
| OQ-P-05 | Login = **email OTP + passkey (WebAuthn)**. No OAuth in Phase 2. SIWE only for **linking** a wallet, never for login | `AuthMethod` extension point in `apps/api/src/auth`. SIWE lives in the wallet module and cannot create sessions |
| OQ-P-06 | **Single-maintainer mode.** The dual-control primitive is implemented properly. In local/dev a second seeded admin approves | ADR-0010 documents the risk |
| OQ-S-01 | **Local development only.** Docker Compose for Postgres 16, Redis, Mailpit, anvil and the OTel collector. Secrets come from git-ignored `.env` through a `SecretProvider` interface | `infra/docker-compose.yml`, `packages/config/src/secrets.ts` |
| OQ-PR-03 | Public testnet RPC for development. Alchemy optional when `ALCHEMY_API_KEY` is set: `fallback([alchemy, public])` | `packages/chain/src/client.ts` |
| OQ-PR-05 | Run the AA spike first. If AA is not confirmed, ship external wallets via SIWE only and stub `SmartAccountProvider` | Spike run (VERIFIED_FACTS §4a): contracts and P-256 present, bundler/paymaster unverified → **SIWE-only** |
| OQ-S-02 | Gas sponsorship / paymaster **OFF** | No paymaster code |
| OQ-P-14 | Do **not** install or run Banchor | Unchanged |
| — | Email delivery via an `EmailProvider` interface. Mailpit (SMTP) locally. No vendor | `apps/api/src/email` |
