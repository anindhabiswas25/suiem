# ADR-0008: Sponsored rewards and campaign escrow

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §11.5–11.6, §12.1 CampaignEscrow; **D-12**

## Context

Rewards must be prefunded, disclosed, separate from $WIF burns, and never framed as yield. On testnet no stablecoin is verified (T-12). USDG is listed for mainnet only.

## Decision

- `CampaignEscrow` holds one approved ERC-20 reward asset per campaign. On testnet that asset is either a **verified testnet stablecoin** (if OQ-PR-06 finds one) or `Suiem Test USD (no value)` / `tUSD`, 6 decimals, with a capped faucet. It is never named USDC or USDG.
- Lifecycle: `createCampaign(rulesHash, asset, budget, start, end, claimWindow)` → `deposit` (must reach budget before `start`, otherwise the campaign cannot open) → `approveSubmission(id, recipient, amount)` by a reviewer role, bounded so Σapproved ≤ budget → `claim` (once per approval) → `refund` of the unapproved remainder to the sponsor after the claim window, or full refund on cancel. Events: `CampaignCreated`, `RewardDeposited`, `SubmissionApproved`, `RewardClaimed`, `CampaignRefunded`, `CampaignCancelled`.
- Separation of duties: the sponsor cannot approve their own campaign's submissions. The reviewer role cannot withdraw. Admin config changes are timelocked.
- Rules text is stored offchain. Its hash is stored onchain. Terms and disclosures are shown before joining.
- Invariants tested: escrow balance ≥ Σ(approved − claimed). No double claims. Refunds conserve funds.

## Consequences

Testnet campaigns show the full flow with no-value tokens. A real stablecoin later is an asset-allowlist change plus legal review.

## Open items

OQ-P-10 (who may sponsor in beta), OQ-PR-06 (testnet stablecoin), OQ-L-06 (reward tax/legal treatment, KYC thresholds).
