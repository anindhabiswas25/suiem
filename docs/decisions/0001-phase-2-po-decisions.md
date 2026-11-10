# Decision 0001: PO decisions for Sprint 2 (hackathon)

Date: 2026-11-10 · Source: `prompts/PHASE_2_PROMPT.md` (hackathon version). The earlier long-term Phase 2 brief is archived at `prompts/PHASE_2_PROMPT_LONGTERM_ARCHIVED.md`, and its decisions are superseded where they conflict.

| Topic | Decision | Consequence |
| --- | --- | --- |
| Direction | World is Flat hackathon. Whole product flow as a working demo | `docs/HACKATHON_PLAN.md`, ADR-0010 |
| Networks | $WIF on mainnet 4663. Stock Tokens on testnet 46630. Everything else off-chain | `packages/config/chains/networks.ts` |
| Auth (OQ-P-05) | Passkey + SIWE (4663 or 46630). **No email** | No OTP, no mail provider |
| Growth loops (OQ-P-13) | Never integrated. No auto-buy | ADR-0001 unchanged |
| Hosting (OQ-S-01) | Vercel (web), Railway (API + Postgres + Redis). **No deploy in Sprint 2**. 12-factor env config | Deploy in Sprint 8 |
| RPC (OQ-PR-03) | Public RPCs on both networks. Alchemy optional via env | `ALCHEMY_API_KEY` |
| Wallets (OQ-PR-05, OQ-S-02) | External EIP-1193 wallets via wagmi. No smart accounts. No sponsorship | `SmartAccountProvider` stays a stub |
| AI (OQ-PR-02) | Claude API, model ID via env, behind a `ResearchModel` interface | Sprint 4 |
| Dual control (OQ-P-06) | Deferred (ADR-0011) | Not built |
| $WIF facts (OQ-P-01) | From the organiser API (VERIFIED_FACTS W-11…W-15) | Burn path verified onchain in Sprint 7 (S7-01) |
