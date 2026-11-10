# ADR-0010: Hackathon scope and two networks

- Status: Accepted (PO, 2026-11-10)
- Supersedes: the **testnet-only** parts of ADR-0001 §1, ADR-0002 §1–2 and ADR-0005 §2. Everything else in those ADRs stands.
- Context source: `prompts/PHASE_2_PROMPT.md`, World is Flat hackathon rules (https://worldisflat.fun/build/rules)

## Context

Suiem is entering the World is Flat hackathon. Submissions close **12 Nov 2026, 17:30 UTC** and the app must stay live until **16 Nov 17:30 UTC**. The rules require **real $WIF transactions on Robinhood Chain**. $WIF exists only on **mainnet (4663)** (VERIFIED_FACTS W-11…W-15). Judges look for a real reason to use $WIF, a flywheel that holds up, and working, well-built software.

## Decision

### 1. Two networks

| Feature | Network | Value at risk |
| --- | --- | --- |
| $WIF elections (burn-to-vote), optional $WIF tips to research authors | **Mainnet 4663** | Real $WIF |
| Optional USDG prize pool for election winners (stretch) | Mainnet 4663 | Small, prefunded |
| Stock Token buy flow | **Testnet 46630** (faucet tokens if verified, otherwise a labelled Suiem demo venue) plus a simulated book | None |
| Extension, research, theses, social, reputation | Off-chain (Postgres) | None |

This map is code: `packages/config/chains/networks.ts` (`FEATURE_NETWORK`). Every onchain action in the UI shows a network badge ("Mainnet · real $WIF" / "Testnet · no value").

### 2. Mainnet exception rules

Real $WIF is at risk, so the mainnet contract (`SuiemElections`, Sprint 7) must:
- **hold no funds** (votes burn or forward in the same call; no balances held between calls)
- have no upgradeability, no admin withdrawal and minimal code
- be tested on an **anvil fork of 4663** against the real $WIF token before deploy
- be deployed **only after explicit PO approval in Sprint 7**

Before Sprint 7 builds on it, the token's `burn`/`burnFrom` and the organiser contract's burn path are checked onchain (S7-01). Event names follow PRD §12.3 (`VoteAssetBurned` only if supply actually decreases).

### 3. Unchanged boundaries

- No automatic buying of any kind. Banchor growth loops are never integrated (OQ-P-13).
- $WIF votes and holdings never affect the Suiem Score.
- Test and demo assets are never presented as securities.
- No Robinhood name or logo in branding. The footer carries "Suiem is not affiliated with Robinhood Markets, Inc." (brand guidelines: https://docs.robinhood.com/chain/brand-guidelines).
- Stock Token features are blocked server-side for the restricted jurisdictions (VERIFIED_FACTS J-01).
- `trading.live` stays hard-off.

### 4. Auth for the hackathon (supersedes OQ-P-05's email-OTP decision)

Passkey (WebAuthn) plus **Sign-In With Ethereum** (EIP-4361) on chain 4663 or 46630. No email login (it would need a mail vendor for the hosted demo). No smart accounts, no gas sponsorship. External EIP-1193 wallets via wagmi.

### 5. Deferred until after the hackathon

External audits, legal sign-off, pen tests, load tests, enterprise admin and dual control (ADR-0011), cloud secret managers, **full RLS coverage** (the DB uses one application role, with user scoping enforced in repositories and API tests), multi-provider failover, OpenTelemetry export.

## Consequences

- The thinnest working version of each piece ships, inside the Phase 1 module boundaries, schemas, viem and the money library.
- Mainnet code carries the most review attention. Everything else optimises for a working end-to-end demo.
