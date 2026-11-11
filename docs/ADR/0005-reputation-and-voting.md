# ADR-0005: Reputation score and $WIF voting

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §10, §11.1–11.4, §12, §5.6; **D-02, D-03, D-09**

## 1. Reputation (D-09)

**Decision.** Suiem Score = 0.5 × Investor + 0.5 × Contribution, each normalized 0–100, with internal weights per PRD §10.2/§10.3. The methodology is versioned (`methodology_version`) and published at `/reputation/methodology`.

- Investor inputs: reconciled fills (simulated and testnet tracked separately and labelled; live does not exist), time-weighted return vs a disclosed benchmark, drawdown discipline, consistency across periods, and frozen thesis outcomes. Risk-adjusted metrics apply only after a minimum history.
- Contribution inputs: research source quality, peer helpfulness weighted for diversity and trust, educational contribution, constructive participation. Penalties for copied content and rings.
- Excluded by construction: $WIF balance or votes, post counts, AI report counts, browsing time, paid promotion.
- Proposed maturity thresholds, pending PO input (OQ-P-07): ≥ 90 days history **and** ≥ 10 evaluated decisions before ranking. Otherwise "Building track record".
- Reproducible from evidence. Snapshots stored. Appeals trigger an audited recompute.

## 2. $WIF token (D-02)

**Facts (VERIFIED_FACTS §6):** everything about $WIF is **UNVERIFIED**. A candidate address `0x5173b8eA6923c2d40267890D45C46a3480954773` appears only in third-party hackathon repos. Several WIF-named tokens exist (impersonation risk). Burn semantics conflict between sources. No testnet deployment is known.

**Decision.**
- Suiem does **not** pick or integrate any $WIF address. The official address, decimals, `burn()` availability and voting mechanic are product-owner confirmation items (OQ-P-01, OQ-P-02), to be checked against the verified source on Blockscout before any mainnet consideration (out of scope).
- On testnet, Suiem deploys **`TestWIF`**: name `Suiem Test WIF (no value)`, symbol `tWIF`, 18 decimals, OpenZeppelin `ERC20` + `ERC20Burnable`, a capped faucet (e.g. 100 tWIF per address per 24 h, enforced onchain), no owner mint after deploy except the faucet allowance. The UI never shows "WIF" without the "Test" prefix.

### Mechanic semantics (stated precisely)

`WIFVoting` is deployed with an immutable `Mode`:

| Mode | Onchain effect | Event | When to use |
| --- | --- | --- | --- |
| `BURN` (testnet default) | `transferFrom(voter → WIFVoting, amount)` then `ERC20Burnable.burn(amount)`. **`totalSupply` decreases by `amount`.** Tokens no longer exist | `VoteAssetBurned(electionId, candidateId, voter, amount)` | Token exposes a real `burn` that reduces supply (TestWIF does) |
| `SINK` | `transferFrom(voter → sink, amount)`. `totalSupply` unchanged. Tokens are held at `sink` | `VoteAssetTransferredToSink(electionId, candidateId, voter, amount, sink)` | Token has no burn. `sink` must be provably irrecoverable (no code with transfer ability, no known key, e.g. `0x…dEaD` documented) or an audited contract with documented post-election destruction |

The brief describes a third variant ("send to the candidate's deposit address, destroyed after the event"). It is modelled as `SINK` with a per-candidate sink contract that has only a `burnAll()` callable after finalization. It is **only** labelled "burned" after `burnAll()` executes and `totalSupply` drops. Until then the UI says "transferred, pending destruction". Tests assert the event name matches the supply effect (PRD §12.3).

Votes are irreversible and not refundable in both modes. If an election is invalidated, the tokens stay destroyed. The UI states this before signing.

## 3. Voting design (D-03)

Proposed defaults, all pending PO and legal (OQ-P-04):
- Eligibility: Suiem account ≥ 14 days old, linked wallet (SIWE), not restricted by moderation. Creators: admin-authorized roles only in beta.
- Weight: 1 tWIF = 1 vote, **with a per-wallet per-election cap** (proposed 10 votes) to limit whale influence. Quadratic weighting is noted as an alternative.
- Live balance at vote time (the burn makes snapshots unnecessary). Votes cannot be changed.
- Sybil: offchain farmed-vote review during a dispute window between `endTime` and `finalize` (mirrors the reported World is Fair offchain check). Votes judged invalid are excluded from results by a published rule. Their tokens stay burned.
- Contract and indexer outage: the election window is enforced onchain by `block.timestamp`. Results finalize only from `final` events. If indexing lags, finalization waits.
- ElectionManager: AccessControl roles (`CREATOR`, `FINALIZER` held by a multisig, `PAUSER`), a timelock for config changes, `ElectionCreated`, `CandidateAdded`, `VoteCast`, `ElectionFinalized`, `ElectionCancelled`. Replay protection via one vote record per `(electionId, voter, nonce)`.
- Votes never change the Suiem Score (§10.4).

## Consequences

The testnet experience shows real burn semantics without touching the real token. Integrating the real $WIF later is a configuration plus verification step, gated by OQ-P-01/02 and a separate mainnet ADR.

## Open items

OQ-P-01, OQ-P-02, OQ-P-04, OQ-P-07, OQ-L-05, OQ-L-06, OQ-S-03.

## Addendum 2026-11-11: hackathon voting rules (Sprint 7, PO decisions; resolves OQ-P-04 for the hackathon)

This addendum supersedes §2's `TestWIF`/`WIFVoting` plan and §3's proposed defaults **for the hackathon only** (ADR-0010 §2 mainnet exception).

- **Asset and mechanic:** the real $WIF on mainnet 4663 (W-12, W-16). `SuiemElections.vote` calls `WIF.burnFrom(voter, votes × 1e18)` and checks that `totalSupply` fell by exactly that amount, or reverts (`BurnNotEffective`). Only then does it emit `VoteAssetBurned`, so "burned" always means supply dropped (PRD §12.3). There is no SINK mode. The organiser's own contract uses a `0x…dEaD` sink (W-15); Suiem does not.
- **Weight:** 1 $WIF = 1 vote, whole tokens only (the function takes a vote count), linear.
- **Cap:** set per election at creation; 25 votes per wallet per election for the hackathon, enforced onchain across all candidates.
- **Eligibility:** anyone may vote onchain. Results show every valid onchain vote. The voter appears as a short address, plus a "Suiem member" marker only when a SIWE-linked wallet's owner allows it via `wallet_visibility`. No account-age rule.
- **Finality of votes:** votes can't be changed, refunded or reversed. A cancelled election keeps its burned tokens burned. Cancel is possible only before the start, so no votes can exist then.
- **Administration:** the owner is a fresh deployer EOA (`Ownable2Step`; multisig deferred, ADR-0011). It can create elections and, before the start, add candidates or cancel. Nothing else: no withdraw, no upgrade, no pause and no change to a running election. Anyone may `finalize` after the end.
- **Candidates:** up to 8, frozen at creation from `research?period=week` / `investors?period=week`. If fewer than 2 rows are ranked, the "Building track record" fallback applies (public published thesis in the last 7 days, or a reconciled testnet/simulated trade). Every candidate must have opted in, be active, have no open moderation report against them or their content, and not be a demo account. The exception is a "Demo election". Onchain they are ids 1..n only.
- **Results:** tallies come only from indexed `VoteCast` events. They are "provisional" until `ElectionFinalized` itself reaches the `finalized` block tag, then "final". The winner gets a profile achievement, never score evidence.
- **Separation:** election code may read leaderboards. Reputation code never reads elections, $WIF or chain code (`reputation-no-economy`). Election code never imports reputation writers (`elections-no-reputation-writes`). An integration test proves voting leaves every `reputation_*` row byte-identical.
- **Deferred:** dispute window (P1), weekly draft scheduler (P1), USDG prize escrow (P1, not verified on 4663).
