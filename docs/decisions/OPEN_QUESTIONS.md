# Open Questions Register

Date opened: 2026-11-10. **Scope changed to the hackathon on 2026-11-10 (ADR-0010).** Phase 2 PO decisions are summarized in [`0001-phase-2-po-decisions.md`](0001-phase-2-po-decisions.md). Owner types: **PO** = product owner, **Legal** = qualified counsel, **Provider** = third-party vendor or chain team, **Security** = security owner.
"Blocks" names the earliest phase that cannot *exit* (or start, where marked ▶) until the question is answered. "Workaround" says how work proceeds meanwhile.

## Product owner

| ID | Question | Blocks | Workaround |
| --- | --- | --- | --- |
| OQ-P-01 | **RESOLVED 2026-11-10 — organiser API: $WIF `0x5173…4773` on 4663, 18 decimals (VERIFIED_FACTS W-11…W-13).** What is the **official** $WIF contract address and chain, and the official World is Fair/World is Flat site or docs? Is `0x5173b8eA6923c2d40267890D45C46a3480954773` (seen only in 3rd-party repos) official? How do "World is Flat" and "World is Fair" relate? | Any real-$WIF work (out of scope). P7 semantics review | TestWIF on testnet (ADR-0005) |
| OQ-P-02 | **RESOLVED 2026-11-10 — organiser: 1 $WIF = 1 vote, burned (W-15). Exact onchain burn path is Sprint 7 task S7-01.** What is the exact voting mechanic: burn per vote via `burn()`, transfer to a per-candidate deposit address destroyed after the event, or something else? What is the burn destination, and is it irrecoverable? | P7 exit (to mirror semantics) | `WIFVoting` supports `BURN` and `SINK` modes |
| OQ-P-03 | Can you get the testnet Stock Token contract addresses (TSLA, AMZN, PLTR, NFLX, AMD) from Robinhood, or approve reading them from the faucet's own transactions on the testnet explorer? | P4 E4.7 | Simulated book only |
| OQ-P-04 | Voting rules: who is eligible, per-wallet cap, 1-token-1-vote vs quadratic, dispute window length, who may create elections | ▶ P7 | Proposed defaults in ADR-0005 §3 |
| OQ-P-05 | **RESOLVED 2026-11-10 — HACKATHON: passkey + SIWE (4663/46630), no email (supersedes OTP decision).** Which login methods: email OTP, passkey, Google/Apple OAuth? Is SIWE-only login allowed? | ▶ P2 E2.3 | Email OTP + passkey proposed |
| OQ-P-06 | **RESOLVED 2026-11-10 — dual control deferred until after the hackathon (ADR-0010 §5, ADR-0011).** Team and ownership: who reviews contracts, extension releases and admin dual-control approvals? | P2 exit | Single-maintainer mode with documented risk |
| OQ-P-07 | Reputation maturity thresholds (proposed ≥ 90 days and ≥ 10 evaluated decisions) and benchmark choice per market | P6 | Proposal in ADR-0005 |
| OQ-P-08 | Default social visibility levels and whether public snapshots may ever show quantities | P5 | Private by default |
| OQ-P-09 | Is a native mobile app needed, and when? | None (post-P8) | PWA |
| OQ-P-10 | Who may sponsor campaigns in the beta (internal only, vetted partners)? | P7 E7.7 | Internal-only |
| OQ-P-11 | Data retention defaults (local summaries 30 d, synced digest 90 d) | P3 exit | Proposed defaults |
| OQ-P-12 | Simulated trading model: fee and slippage assumptions, market-hours rule, starting paper balance | P4 exit | Conservative defaults, disclosed |
| OQ-P-13 | **RESOLVED 2026-11-10 — APPROVED: no growth loops ever, incl. opt-in variants.** Approve that Suiem **never** integrates Banchor's growth loops (ADR-0001 §4), including future "opt-in" variants | P1 exit | — |
| OQ-P-14 | **RESOLVED 2026-11-10 — do not install/run Banchor.** May the Phase 2 agent run Banchor's test suites in a sandbox (`npm install` in an isolated container) to establish a baseline? | None | Tests documented but not run |

## Legal

| ID | Question | Blocks | Workaround |
| --- | --- | --- | --- |
| OQ-L-01 | In India (and other launch jurisdictions), are AI research briefs, simulated trading and public theses regulated activities (e.g. SEBI research-analyst / investment-adviser rules)? What disclaimers apply? | P3 exit (research publishing), P5 exit | Educational framing, no recommendations |
| OQ-L-02 | Can Indian residents ever access Robinhood Stock Tokens (RHJ debt securities) via Suiem? FEMA/LRS, tax, advertising implications | Any live trading (out of scope) | Live trading off everywhere |
| OQ-L-03 | Browser-extension data collection under DPDP Act 2023 (India), GDPR/ePrivacy if EU users, and Chrome Web Store policy | P3 exit | Minimal, consented, local-first design |
| OQ-L-04 | Social posts about securities: financial-promotion and market-manipulation rules, sponsored-content disclosure | P5 exit | Labels + moderation |
| OQ-L-05 | Could a public "Suiem Score" be treated as a rating or advice? Required wording | P6 exit | "Not a financial rating" disclaimer |
| OQ-L-06 | Legal and tax treatment of token-burn voting and sponsor-funded rewards (even testnet promotions), KYC/AML thresholds | P7 exit | No-value test tokens only |
| OQ-L-07 | Terms of service and privacy notice for the controlled testnet beta | ▶ P8 beta | — |

## Provider

| ID | Question | Blocks | Workaround |
| --- | --- | --- | --- |
| OQ-PR-01 | **HACKATHON 2026-11-11: SEC EDGAR + Finnhub free tier (non-commercial; licence for a commercial launch still open).** Financial data/news provider: licence for display, caching, AI summarization; coverage; cost | ▶ P3 E3.7 (real data) | Fixture data in dev only, never shown to beta users |
| OQ-PR-02 | **RESOLVED 2026-11-10 — Claude API, model ID via env, `ResearchModel` interface. SUPERSEDED 2026-11-11 (PO, Sprint 4): free tiers only — Groq `openai/gpt-oss-120b` primary, Gemini `gemini-3.5-flash` fallback (VERIFIED_FACTS R-01/R-02).** LLM providers: data retention, training use, region, cost, SLAs (≥ 2 for failover) | ▶ P3 E3.7 | — |
| OQ-PR-03 | **RESOLVED 2026-11-10 — public testnet RPC for dev. Alchemy optional via `ALCHEMY_API_KEY`.** RPC plan for 46630 (Alchemy tier, rate limits, archive and `finalized` tag support) | P2 exit | Public RPC for development |
| OQ-PR-04 | Robinhood: does any testnet trading venue (AMM/RFQ) exist for test Stock Tokens? | P4 E4.8 TestnetVenue | SimulatedVenue |
| OQ-PR-05 | **RESOLVED 2026-11-10 — no smart accounts for the hackathon. External wallets via wagmi.** AA on testnet: EntryPoint deployed? Bundler and paymaster from Alchemy/ZeroDev for 46630? P-256 passkey validator support? | P2 E2.7 | External wallets only |
| OQ-PR-06 | Is there a verified testnet stablecoin (USDG or other) on 46630? | P7 E7.7 | `tUSD` test token |

## Security

| ID | Question | Blocks | Workaround |
| --- | --- | --- | --- |
| OQ-S-01 | **RESOLVED 2026-11-10 — Vercel (web) + Railway (API, Postgres, Redis), deploy in Sprint 8. Local Docker Compose now.** Hosting, cloud account, secret manager, KMS for the testnet deployer key | ▶ P2 | Local dev only |
| OQ-S-02 | **RESOLVED 2026-11-10 — paymaster OFF in Phase 2.** Paymaster abuse limits (per-user gas budget, rate) | P2 E2.7 | Sponsorship off |
| OQ-S-03 | Multisig (Safe) signers and threshold for contract admin roles. Is Safe deployed on 46630? (unverified) | ▶ P7 deploy | Timelocked single deployer on testnet, documented |
| OQ-S-04 | Budget and vendor for an external pen test and contract review before the beta | P8 exit | Internal review only |
| OQ-S-05 | Chrome Web Store publisher account ownership and 2FA policy | P3 exit | Unpacked dev builds |

## Hackathon (added 2026-11-10)

| ID | Question | Owner | Blocks | Default taken |
| --- | --- | --- | --- | --- |
| OQ-H-01 | Repo visibility for submission: public, or invite GitHub `wifonrh`? | PO | Sprint 8 | Keep private until Sprint 8 |
| OQ-H-02 | Jurisdiction source for Stock Token gating: self-declared country at onboarding (Sprint 2 stub) vs IP geolocation | PO | Sprint 5 | Self-declared, server-checked against J-01. Undeclared = blocked |
| OQ-H-03 | Re-read the RHJ restricted-jurisdictions page directly (J-01 is PO-supplied) | Eng | Sprint 5 | Task S5-01 |
| OQ-H-04 | Onchain check of $WIF `burn`/`burnFrom` and the organiser contract's burn path | Eng | Sprint 7 | Task S7-01 |
| OQ-H-05 | Passkey-only users have no wallet: is that acceptable for a judge (wallet needed only to vote)? | PO | Sprint 7 | Yes: research works without a wallet; linking prompted at vote time |
| OQ-H-06 | Display name for SIWE/passkey users: allow a free-text name, or default to a short address/handle? | PO | Sprint 6 | Optional free-text name, default `user-xxxx` |

| OQ-H-07 | Extension distribution for judges: unpacked zip (default) or an unlisted Chrome Web Store listing (needs a developer account and review time) | PO | Sprint 8 | Unpacked zip + README |
| OQ-H-08 | x.com markup may change; detector falls back to `article`/`p` text if `[data-testid="tweetText"]` disappears | Eng | Demo day | Re-check live before recording |
| OQ-H-09 | Finnhub free plan is non-commercial. Fine for the hackathon demo; a commercial launch needs a paid licence or another provider (display, caching, AI summarisation rights) | PO | Post-hackathon | Labelled "Finnhub (free tier)" |
| OQ-H-10 | Groq free TPM (8K) means two briefs within a minute push the second to Gemini. For the demo video, space requests ~1 min apart or accept Gemini output | PO | Sprint 8 | Fallback is automatic and labelled |

## Conflicts recorded (PRD §0.2 rule 12)

| ID | Conflict | Resolution proposed |
| --- | --- | --- |
| C-01 | Banchor README claims session-key spending caps and gas sponsorship. The code has neither | Treat as absent (REPO_AUDIT §3.3) |
| C-02 | Phase brief says faucet test Stock Tokens "reportedly" exist. Docs don't mention them. The Arbitrum blog confirms the faucet hands them out | Faucet existence VERIFIED. Addresses UNVERIFIED (OQ-P-03) |
| C-03 | $WIF mechanic: deposit-address-then-destroy (brief) vs per-vote `burn()` (3rd-party repos) | Both modelled. PO decides (OQ-P-02) |
| C-04 | Brief calls Robinhood Chain an "Arbitrum Orbit chain". Docs say "Arbitrum Chain running Arbitrum Nitro" / "Arbitrum Dedicated Blockchains" | Use the docs' wording. No engineering impact |
| C-05 | PRD §23 Release 7 includes "Public launch". The Phase 8 brief limits it to a controlled testnet beta | Phase 8 = testnet beta only |
