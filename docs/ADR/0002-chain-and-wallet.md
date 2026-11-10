# ADR-0002: Chain configuration and wallet model

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §5.1, §12, §13.2, §16.2; **D-01, D-06**

## Context

Banchor targets Monad testnet with a Mera passkey-derived EOA. Its claimed session-key spending cap does not exist (REPO_AUDIT §3.3). Robinhood Chain docs state ERC-4337 support with EntryPoint v0.7/v0.8 and providers Alchemy, ZeroDev, Privy and Dynamic, but list addresses only under mainnet 4663 (VERIFIED_FACTS A-01…A-05).

## Decision

### 1. Chain configuration (D-01)

| Item | Value | Status |
| --- | --- | --- |
| Chain ID | 46630 | VERIFIED |
| RPC (primary) | Alchemy `robinhood-testnet` endpoint (key via secret manager) | VERIFIED endpoint shape |
| RPC (fallback) | `https://rpc.testnet.chain.robinhood.com` | VERIFIED. Docs say not for production, so it is fallback only |
| Explorer | `https://explorer.testnet.chain.robinhood.com` | VERIFIED |
| Gas | ETH | VERIFIED |
| Finality | soft (sequencer) → safe (batch posted) → final (Ethereum finalized) | VERIFIED stages |
| Time source in contracts | `block.timestamp` only. `block.number` is an L1 estimate | VERIFIED (C-18) |

- Config lives in `packages/config/chains/robinhood-testnet.ts`, and every value has a `VERIFIED_FACTS` row ID in a comment. At boot every service asserts that `eth_chainId === 46630` and refuses to start otherwise.
- viem client: `fallback([alchemy, public])`, no JSON-RPC batching until tested, `cacheTime: 0` for head reads. Multicall only at an address whose `eth_getCode` is confirmed (T-08 is the verified L2 Multicall; Multicall3 is UNVERIFIED).
- The indexer reads `safe` and `finalized` tags. UI states: "Submitted" (soft), "Posted" (safe), "Final".
- A testnet reset is handled: the indexer stores the genesis hash and halts with an alert if it changes.

### 2. Wallet model (D-06)

- **Account first, wallet optional.** Suiem login (email OTP or passkey WebAuthn on the Suiem origin) is separate from any wallet.
- **Option A, default when verified: ERC-4337 smart account** created through a provider SDK (Alchemy Account Kit or ZeroDev, chosen after a testnet spike) with a passkey (WebAuthn P-256) signer and an email/social recovery guardian. Gas is sponsored on testnet by a paymaster with a strict per-user policy.
- **Option B, always available: external EOA wallets** (MetaMask, Robinhood Wallet, any EIP-1193) linked via SIWE.
- **No session keys, no spending-cap delegation, no automation modules** are installed (ADR-0001 §2). Each operation is signed per action.
- Approvals: Permit2 (T-10) or exact-amount `approve`. Unlimited approvals are rejected in code review and by a lint rule on calldata builders.
- Calldata is built server-side from registry addresses, and a **preview hash** covers `(chainId, to, data, value)`. The web app re-encodes from the preview, compares hashes, and shows a decoded call before invoking the wallet.
- Private keys never reach the backend (§16.2). The backend stores only addresses, account type and provider metadata.

### 3. Verification spike (first Phase 2 task, before wallet code)

On 46630, using read-only calls and no funds: `eth_getCode` for EntryPoint v0.7/v0.8 (A-02). Check whether the chosen provider offers a testnet bundler and paymaster (A-03). Check P-256 verification support (RIP-7212 precompile or a Solidity verifier fallback, A-05). Record the results in `VERIFIED_FACTS`. **If AA is unavailable on testnet, ship Option B only** and keep the smart-account interface stubbed.

## Consequences

- Banchor's Mera and `withSigner` code is not reused. Its per-action key-wipe discipline carries over as a requirement.
- The extension has no wallet. Uninstalling it affects no account or wallet access (§6.7).
- Recovery UX and custody disclosure are Phase 2 deliverables with tests.

## Open items

OQ-PR-03 (RPC provider plan), OQ-PR-05 (AA provider on testnet), OQ-S-02 (paymaster abuse limits), OQ-P-05 (auth methods).
