# packages/contracts

Foundry project (solc 0.8.30, optimizer 200 runs). OpenZeppelin v5.6.1 and forge-std v1.16.2 are pinned and installed into `lib/` (git-ignored) by `pnpm contracts:deps`.

## Sprint 5: Suiem demo venue (Robinhood Chain **testnet 46630 only**, no value)

| Contract | What it does |
| --- | --- |
| `DemoUSD` (`dUSD`, 6 decimals) | "Suiem Demo USD (testnet, no value)". `claim()` gives 1,000 dUSD once per address per 24 h. Only the venue (fixed at deployment) can mint or burn. No admin mint. |
| `DemoStockToken` (`dTSLA`, `dAMZN`, `dPLTR`, `dNFLX`, `dAMD`; 18 decimals) | "Suiem Demo `<TICKER>` (testnet, no value)". Not a share, not a security, not a Stock Token. Only the venue can mint and burn. |
| `SuiemDemoVenue` | `buy`/`sell` with an EIP-712 `Quote {trader, token, side, amountIn, price, feeBps, expiry, nonce}` signed by the Suiem quote signer. Domain `{SuiemDemoVenue, 1, chainId, venue}`. Checks: signer, `msg.sender == trader`, `block.timestamp <= expiry` and expiry at most 60 s ahead (never `block.number`, VERIFIED_FACTS C-18), unused nonce, listed token, `out >= minOut`, fee ≤ 1%. Buy pulls exactly `amountIn` dUSD (exact approval from the UI), burns it except the fee, and mints demo stock. Sell burns demo stock and mints dUSD. Emits `Trade(trader, token, side, amountIn, amountOut, price, fee, nonce)`. Admin (Ownable2Step): set quote signer, list tokens, pause. No upgradeability. Holds only collected dUSD fees. |

Price units: dUSD base units (6 dp) per one whole demo token (1e18). All rounding favours the venue: the fee rounds up and output rounds down.

## Commands

```bash
pnpm contracts:deps                 # install pinned OZ + forge-std into lib/
pnpm contracts:test                 # unit, fuzz and invariant tests
pnpm contracts:deploy:testnet       # testnet 46630 ONLY: needs TESTNET_DEPLOYER_PRIVATE_KEY + QUOTE_SIGNER_PRIVATE_KEY in .env
pnpm contracts:abis                 # regenerate typed ABIs into packages/chain/src/abi/demo.ts
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

Slither 0.11.3 (2026-11-11) reported 5 results. All are accepted; see `docs/sprints/SPRINT_5.md`.

Never deploy to mainnet (4663). Testnet deploys were pre-approved by the PO for Sprint 5 only.
