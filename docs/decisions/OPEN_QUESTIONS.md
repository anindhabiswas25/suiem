# Open Questions Register

Date opened: 2026-11-10. Owner types: **PO** = product owner, **Legal** = qualified counsel, **Provider** = third-party vendor or chain team, **Security** = security owner.
"Blocks" names the earliest phase that cannot *exit* (or start, where marked ▶) until the question is answered. "Workaround" says how work proceeds meanwhile.

## Product owner

| ID | Question | Blocks | Workaround |
| --- | --- | --- | --- |
| OQ-P-01 | What is the **official** $WIF contract address and chain, and the official World is Fair/World is Flat site or docs? Is `0x5173b8eA6923c2d40267890D45C46a3480954773` (seen only in 3rd-party repos) official? How do "World is Flat" and "World is Fair" relate? | Any real-$WIF work (out of scope). P7 semantics review | TestWIF on testnet (ADR-0005) |
| OQ-P-02 | What is the exact voting mechanic: burn per vote via `burn()`, transfer to a per-candidate deposit address destroyed after the event, or something else? What is the burn destination, and is it irrecoverable? | P7 exit (to mirror semantics) | `WIFVoting` supports `BURN` and `SINK` modes |
| OQ-P-03 | Can you get the testnet Stock Token contract addresses (TSLA, AMZN, PLTR, NFLX, AMD) from Robinhood, or approve reading them from the faucet's own transactions on the testnet explorer? | P4 E4.7 | Simulated book only |
| OQ-P-04 | Voting rules: who is eligible, per-wallet cap, 1-token-1-vote vs quadratic, dispute window length, who may create elections | ▶ P7 | Proposed defaults in ADR-0005 §3 |
| OQ-P-05 | Which login methods: email OTP, passkey, Google/Apple OAuth? Is SIWE-only login allowed? | ▶ P2 E2.3 | Email OTP + passkey proposed |
| OQ-P-06 | Team and ownership: who reviews contracts, extension releases and admin dual-control approvals? | P2 exit | Single-maintainer mode with documented risk |
| OQ-P-07 | Reputation maturity thresholds (proposed ≥ 90 days and ≥ 10 evaluated decisions) and benchmark choice per market | P6 | Proposal in ADR-0005 |
| OQ-P-08 | Default social visibility levels and whether public snapshots may ever show quantities | P5 | Private by default |
| OQ-P-09 | Is a native mobile app needed, and when? | None (post-P8) | PWA |
| OQ-P-10 | Who may sponsor campaigns in the beta (internal only, vetted partners)? | P7 E7.7 | Internal-only |
| OQ-P-11 | Data retention defaults (local summaries 30 d, synced digest 90 d) | P3 exit | Proposed defaults |
| OQ-P-12 | Simulated trading model: fee and slippage assumptions, market-hours rule, starting paper balance | P4 exit | Conservative defaults, disclosed |
| OQ-P-13 | Approve that Suiem **never** integrates Banchor's growth loops (ADR-0001 §4), including future "opt-in" variants | P1 exit | — |
| OQ-P-14 | May the Phase 2 agent run Banchor's test suites in a sandbox (`npm install` in an isolated container) to establish a baseline? | None | Tests documented but not run |

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
| OQ-PR-01 | Financial data/news provider: licence for display, caching, AI summarization; coverage; cost | ▶ P3 E3.7 (real data) | Fixture data in dev only, never shown to beta users |
| OQ-PR-02 | LLM providers: data retention, training use, region, cost, SLAs (≥ 2 for failover) | ▶ P3 E3.7 | — |
| OQ-PR-03 | RPC plan for 46630 (Alchemy tier, rate limits, archive and `finalized` tag support) | P2 exit | Public RPC for development |
| OQ-PR-04 | Robinhood: does any testnet trading venue (AMM/RFQ) exist for test Stock Tokens? | P4 E4.8 TestnetVenue | SimulatedVenue |
| OQ-PR-05 | AA on testnet: EntryPoint deployed? Bundler and paymaster from Alchemy/ZeroDev for 46630? P-256 passkey validator support? | P2 E2.7 | External wallets only |
| OQ-PR-06 | Is there a verified testnet stablecoin (USDG or other) on 46630? | P7 E7.7 | `tUSD` test token |

## Security

| ID | Question | Blocks | Workaround |
| --- | --- | --- | --- |
| OQ-S-01 | Hosting, cloud account, secret manager, KMS for the testnet deployer key | ▶ P2 | Local dev only |
| OQ-S-02 | Paymaster abuse limits (per-user gas budget, rate) | P2 E2.7 | Sponsorship off |
| OQ-S-03 | Multisig (Safe) signers and threshold for contract admin roles. Is Safe deployed on 46630? (unverified) | ▶ P7 deploy | Timelocked single deployer on testnet, documented |
| OQ-S-04 | Budget and vendor for an external pen test and contract review before the beta | P8 exit | Internal review only |
| OQ-S-05 | Chrome Web Store publisher account ownership and 2FA policy | P3 exit | Unpacked dev builds |

## Conflicts recorded (PRD §0.2 rule 12)

| ID | Conflict | Resolution proposed |
| --- | --- | --- |
| C-01 | Banchor README claims session-key spending caps and gas sponsorship. The code has neither | Treat as absent (REPO_AUDIT §3.3) |
| C-02 | Phase brief says faucet test Stock Tokens "reportedly" exist. Docs don't mention them. The Arbitrum blog confirms the faucet hands them out | Faucet existence VERIFIED. Addresses UNVERIFIED (OQ-P-03) |
| C-03 | $WIF mechanic: deposit-address-then-destroy (brief) vs per-vote `burn()` (3rd-party repos) | Both modelled. PO decides (OQ-P-02) |
| C-04 | Brief calls Robinhood Chain an "Arbitrum Orbit chain". Docs say "Arbitrum Chain running Arbitrum Nitro" / "Arbitrum Dedicated Blockchains" | Use the docs' wording. No engineering impact |
| C-05 | PRD §23 Release 7 includes "Public launch". The Phase 8 brief limits it to a controlled testnet beta | Phase 8 = testnet beta only |
