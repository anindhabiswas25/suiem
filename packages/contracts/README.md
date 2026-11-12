# packages/contracts

Foundry project (solc 0.8.30, optimizer 200 runs). OpenZeppelin v5.6.1 and forge-std v1.16.2 are pinned and installed into `lib/` (git-ignored) by `pnpm contracts:deps`.

## Sprint 5: Suiem demo venue (Robinhood Chain **testnet 46630 only**, no value)

| Contract | What it does |
| --- | --- |
| `DemoUSD` (`dUSD`, 6 decimals) | "Suiem Demo USD (testnet, no value)". `claim()` gives 1,000 dUSD once per address per 24 h. Only the venue (fixed at deployment) can mint or burn. No admin mint. |
| `DemoStockToken` (`dTSLA`, `dAMZN`, `dPLTR`, `dNFLX`, `dAMD`; 18 decimals) | "Suiem Demo `<TICKER>` (testnet, no value)". Not a share, not a security, not a Stock Token. Only the venue can mint and burn. |
| `SuiemDemoVenue` | `buy`/`sell` with an EIP-712 `Quote {trader, token, side, amountIn, price, feeBps, expiry, nonce}` signed by the Suiem quote signer. Domain `{SuiemDemoVenue, 1, chainId, venue}`. Checks: signer, `msg.sender == trader`, `block.timestamp <= expiry` and expiry at most 60 s ahead (never `block.number`, VERIFIED_FACTS C-18), unused nonce, listed token, `out >= minOut`, fee ≤ 1%. Buy pulls exactly `amountIn` dUSD (exact approval from the UI), burns it except the fee, and mints demo stock. Sell burns demo stock and mints dUSD. Emits `Trade(trader, token, side, amountIn, amountOut, price, fee, nonce)`. Admin (Ownable2Step): set quote signer, list tokens, pause. No upgradeability. Holds only collected dUSD fees. |

Price units: dUSD base units (6 dp) per one whole demo token (1e18). All rounding favours the venue: the fee rounds up and output rounds down.

## Sprint 7: `SuiemElections` (Robinhood Chain **mainnet 4663**, real $WIF)

Burn-to-vote elections: 1 $WIF = 1 vote, whole tokens, per-wallet cap. `vote(id, candidateId, votes)` calls `WIF.burnFrom(msg.sender, votes × 1e18)` and requires `totalSupply` to fall by exactly that amount before it emits `VoteCast` and `VoteAssetBurned`.

### Security note

- **Trust assumptions:**
  - $WIF at `0x5173…4773` behaves as verified onchain (VERIFIED_FACTS W-16): OZ-style `burnFrom` that spends allowance and lowers supply, with no fee, hooks or pause.
  - The `totalSupply` check makes the contract fail closed if that ever changes.
  - The owner key is a single EOA (multisig deferred, ADR-0011).
- **The owner CAN:**
  - `createElection(start, end, cap, candidateCount)` (start must be in the future)
  - `addCandidates(id, n)` and `cancel(id)`, but **only before the start**
  - transfer ownership (two-step)
- **The owner CANNOT:**
  - move, withdraw or mint any token
  - pause or alter an open election
  - change times, cap or candidates after the start
  - upgrade the code (no proxy, no `delegatecall`, no `selfdestruct`)
  - receive ETH (no `receive`, no payable functions)
- **Funds:** the contract never holds $WIF or ETH. The burn goes straight from the voter's balance. Invariant-tested: balances are always 0.
- **Votes are irreversible:** burned tokens are destroyed. Nothing can refund them, including cancellation (which is only possible before any vote can exist).
- **Finalization:** anyone may call `finalize(id)` once `block.timestamp >= endTime`. The window uses `block.timestamp`, never `block.number` (C-18).
- **Privacy:** candidates are sequential ids. Who they are lives off-chain (`election_candidates`).

### Tests (`test/SuiemElections.t.sol`, `test/fork/SuiemElectionsFork.t.sol`)

- **Unit tests:**
  - constructor guards
  - create validation
  - only the owner can create, add or cancel
  - two-step ownership
  - window edges (start second, last second, end second)
  - cap across candidates
  - whole tokens and zero votes
  - unknown candidate or election
  - allowance and balance errors
  - cancelled election
  - finalize timing and once-only
  - exact event arguments
  - a fake "burn" that doesn't lower supply reverts
- **Fuzz:** random amounts never break the cap, and burned equals tallied.
- **Invariants (128k calls):**
  - the contract's $WIF and ETH balances stay at 0
  - `sum(votes) == totalVotes`
  - total burned equals total tallied equals the supply drop
  - the cap is respected
- **Fork tests (real $WIF, pinned block 111,685,000):**
  - impersonate the PO wallet, approve and vote, then assert supply fell by exactly the amount, the voter's balance fell and the contract balance is 0
  - the cap and a vote after the end on the real token
  - token identity
  - These need `MAINNET_RPC_URL` (`pnpm contracts:test:fork`). Without it they are **skipped with a visible message** (CI).

## Commands

```bash
pnpm contracts:deps                 # install pinned OZ + forge-std into lib/
pnpm contracts:test                 # unit, fuzz and invariant tests
pnpm contracts:deploy:testnet       # testnet 46630 ONLY: needs TESTNET_DEPLOYER_PRIVATE_KEY + QUOTE_SIGNER_PRIVATE_KEY in .env
pnpm contracts:test:fork            # mainnet fork tests (reads MAINNET_RPC_URL from .env; never sends anything)
pnpm contracts:deploy:mainnet --estimate                     # 4663: checks + gas estimate, no tx
CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL pnpm contracts:deploy:mainnet --verify   # PO approval required
pnpm contracts:abis                 # regenerate typed ABIs into packages/chain/src/abi/{demo,elections}.ts
```

`scripts/deploy-testnet.ts` refuses any RPC whose chain ID is not 46630 (and `DeployTestnet.s.sol` asserts `block.chainid == 46630`). It stops if the deployer has no testnet ETH, then writes `deployments/46630.json` with addresses, tx hashes, block, git SHA, compiler and constructor args, and attempts Blockscout verification. Keys come from the environment only and are never printed. The API, seed (`DEMO:*` instruments) and web read that manifest.

## Tests

`test/SuiemDemoVenue.t.sol`:

- **Unit tests:**
  - metadata says "no value"
  - buy → sell vectors
  - `Trade` event
  - replayed nonce
  - expiry at the exact boundary
  - quote longer than 60 s
  - wrong chain ID
  - wrong verifying contract
  - wrong signer
  - wrong trader
  - tampered amount
  - side mismatch
  - `minOut`
  - unlisted token
  - paused
  - insufficient allowance
  - non-venue mint/burn
  - owner-only + two-step admin
  - faucet cooldown
- **Fuzz:** buy and sell rounding never favours the trader; a buy→sell round trip never profits.
- **Invariant (128k calls):** dUSD in = fees kept + dUSD burned, and minted stock value at the signed price ≤ dUSD burned.

Slither 0.11.3 (2026-11-11) reported 5 results. All were reviewed and accepted.

Mainnet (4663) is used **only** for `SuiemElections`, and every mainnet transaction (deploy, create, cancel, finalize by the owner) needs explicit PO approval in chat. `deploy-mainnet.ts` refuses unless:
- the chain is 4663
- `CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL` is set
- $WIF passes the identity check
- the deployer holds at least 2× the estimated cost

It never prints the key or the RPC URL, and it writes `deployments/4663.json` without the RPC. Testnet deploys were pre-approved by the PO for Sprint 5 only.
