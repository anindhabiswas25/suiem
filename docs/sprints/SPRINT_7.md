# Sprint 7: $WIF economy on mainnet (backend)

- Date: 2026-11-11 · Branch: `hackathon/main` · Brief: `prompts/PHASE_7_PROMPT.md`
- Status: **backend complete and rehearsed end to end on a mainnet fork. No mainnet transaction yet: waiting for explicit PO approval** (deploy + elections). The elections web UI is moved to S8-02 by PO instruction. Nothing pushed.

## S7-01 findings (VERIFIED_FACTS W-15, W-16, W-17)

The RPC was the PO's QuickNode endpoint (secret, `.env` only). `eth_chainId` returned `0x1237`. Mainnet Blockscout's API answered HTTP 403 to scripted requests, so every fact below comes from bytecode, `eth_call`, logs and fork tests, not from the verified-source page.

| Check | $WIF `0x5173b8eA6923c2d40267890D45C46a3480954773` | Organiser `0xd1b711917a405782da2ec650a0ee4711a76a5535` |
| --- | --- | --- |
| Code | 3,248 bytes, deployed at block 29,235,958 | 651 bytes, deployed at block 108,517,622 |
| Proxy | No (EIP-1967 slot is zero) | No |
| Identity | `name` "World is Flat", `symbol` "WIF", `decimals` 18 | `wif()` = $WIF |
| Burn | `burn(uint256)`, `burnFrom(address,uint256)`. Real burns lower supply exactly: [`0xaf2a…e90b`](https://robinhoodchain.blockscout.com/tx/0xaf2a339bf235c98d7b5e3788e0fb153b7a94de09142ca324197215e78ef9e90b) (−1 WIF), [`0xa640…b0d6`](https://robinhoodchain.blockscout.com/tx/0xa640e96bfc77734888ef71eea47df2be0668f26499416dbeec00f9dea704b0d6) (−20 WIF) | Only token call is `transferFrom`. `BURN_ADDRESS()` = `0x…dEaD`, so it is a **sink**: supply doesn't drop |
| Fee, pause, blocklist, hooks | None: no such selectors. A 1 WIF transfer arrived in full on the fork | n/a |
| Real `Voted` tx | n/a | **None.** No events at all from deploy to block 111,685,646, so there is nothing to check |

- **Mechanic chosen:** `burnFrom` exists and lowers supply, so `vote` calls `WIF.burnFrom(voter, votes × 1e18)` and the voter approves `SuiemElections`.
- **Extra guard:** the contract re-reads `totalSupply` and reverts unless it fell by exactly the amount, so `VoteAssetBurned` can never be emitted without a real supply drop.
- **Lookalike defence:** $WIF is a checksummed constant in `packages/config/chains/wif.ts` (and in `DeployMainnet.s.sol`). Nothing accepts a token address from input. At startup the API (when deployed), the indexer, the deploy script and both CLIs assert chain 4663, 18 decimals, "WIF" and "World is Flat".
- **Finality tags (Arbitrum Orbit):** `safe` and `finalized` are both served. `eth_getLogs` is capped at 10,000 blocks (`-32614`). `eth_simulateV1` is supported and used by the vote preview.

## Contract design and trust assumptions

`packages/contracts/src/SuiemElections.sol` (solc 0.8.30, OZ v5.6.1). Source keccak256 `0x05aeb057b95c3dbf1a9cd1a68393060d04d230462a25f68cf2975443f5a780c2` (sha256 `3d8b77e6…425e`), unchanged since commit `5a58c23`.

- **Base:** `Ownable2Step` and `ReentrancyGuard`. `WIF` is `immutable`, and the constructor checks 18 decimals.
- **Not present:** proxy, `delegatecall`, `receive`, payable functions, pause, withdraw.
- **Storage:** `elections[id] = {startTime, endTime, capPerWallet, candidateCount, status(Scheduled|Cancelled|Finalized), totalVotes}`, `votes[id][candidateId]`, `votedBy[id][voter]`.
- **Functions:**
  - `createElection(start, end, cap, candidateCount ≤ 8)` (owner; start must be in the future)
  - `addCandidates` and `cancel` (owner, **before start only**)
  - `vote(id, candidateId, votes)`: open iff `start ≤ block.timestamp < end`; candidate in 1..n; `votes > 0`; cap across candidates; `burnFrom`; supply check
  - `finalize(id)` (anyone, at or after end, once)
  - views: `getElection`, `phase` (Scheduled/Open/Closed/Finalized/Cancelled), `tallies`, `remainingCap`, `votes`, `votedBy`
- **Events:** `ElectionCreated(id, start, end, cap, candidateCount)` (the candidate count is in this event), `CandidatesAdded(id, newCount)`, `VoteCast(id, candidateId, voter, votes)`, `VoteAssetBurned(id, candidateId, voter, amount)`, `ElectionFinalized(id, totalVotes)`, `ElectionCancelled(id)`.
- **The owner can't:**
  - touch tokens
  - change or pause a running election
  - upgrade
  - refund
- Votes are final. Cancelling is only possible before any vote can exist.
- **Security note:** `packages/contracts/README.md`.

## Built

| Brief § | Delivered |
| --- | --- |
| 1 Contract | As above, with NatSpec on everything |
| 2 Tests | Foundry suites:<br>• **Unit (18):** window edges, cap, whole tokens, unknown candidate/election, cancelled, finalize timing, owner-only, 2-step ownership, event args, fake-burn revert<br>• **Fuzz (1):** cap and burned = tallied<br>• **Invariants (3, 128k calls):** zero balances, `sum(votes) == totalVotes`, supply drop = burned, cap<br>• **Fork (4) against real $WIF at block 111,685,000:** CI-skippable with a visible message |
| 3 Deploy tooling | `script/DeployMainnet.s.sol` + `scripts/deploy-mainnet.ts` (`pnpm contracts:deploy:mainnet [--estimate] [--verify]`). Refuses unless chain 4663, `CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL`, $WIF identity OK and balance ≥ 2× estimated cost. The key comes from `MAINNET_DEPLOYER_PRIVATE_KEY` and is never printed. The RPC goes to forge via env, not argv, and all forge output is redacted. Writes `deployments/4663.json` (address, tx hashes, block, git SHA, compiler, constructor args, `WIF`, source hash) and refuses to write it if the RPC URL would appear. Runs Blockscout verification. **Deployer key** generated with `out=$(cast wallet new 2>&1)`, never echoed, written to `.env`. Only the address was printed: **`0x7f84f0710F5D7d44DeD117800198F970066C0b9E`** |
| 3 Owner CLI | `pnpm elections:create`:<br>• snapshots candidates (fallback + labels) and prints a dry-run summary: chain, contract, times, cap, candidates, gas estimate, owner balance<br>• **sends only with `--send` and `CONFIRM_MAINNET_TX=I_HAVE_PO_APPROVAL`**<br>• writes the draft election + frozen candidates, sends `createElection`, parses `ElectionCreated`, marks the row `scheduled` and writes `audit_logs`<br>• `--finalize <slug>` / `--cancel <slug>` use the same gates |
| 4 Indexer | `workers/indexer` (`ElectionsIndexer`). Runs inline in the API (`INDEXER=inline`, every `INDEXER_POLL_MS` = 12 s) or standalone (`pnpm --filter @suiem/indexer start`). Each tick it:<br>• re-checks block hashes of non-final event blocks<br>• re-scans from `min(cursor, finalized+1)` in `INDEXER_LOG_RANGE` chunks (default 5000; halved on a range error)<br>• upserts on `UNIQUE(chain_id, tx_hash, log_index)` with `block_hash`<br>• marks vanished non-final logs `removed` (rows are never deleted; DB trigger)<br>• updates finality (`soft` > `safe` > `final`) and the cursor in the new `indexer_cursors` table<br>• rebuilds `election_tallies` from non-removed `VoteCast` (`as_of_block`, weakest finality)<br>• **cross-checks against `tallies()`** and logs `indexer.tally_mismatch` at error level, never overwriting<br>• moves status `scheduled → open → closed → finalized`/`cancelled` from events and chain time<br>• marks the result `final` only when `ElectionFinalized` is itself final<br>• sends `election_nominated` (on open) and `election_result` (on final) notifications, once each (unique index) |
| 5 API | `GET /elections?status=`, `GET /elections/:slug`, `GET /elections/:slug/votes?cursor=`, `POST /elections/:slug/vote/preview`, `POST /elections/:slug/votes` (Idempotency-Key), `GET /me/votes`. Device tokens get 403 on all of them; previews are rate-limited 30 per 10 min per user. The **preview** returns:<br>• balance, allowance, remaining cap<br>• exact approve + vote calldata, decoded<br>• an `eth_simulateV1` of approve → vote from the voter's wallet<br>• `chainId: 4663` and the exact burn notice<br>• `previewHash` over (chain, **voter**, approve, vote)<br>**Binding** checks chain, contract, sender = linked wallet, calldata = previewed vote, success, and a matching `VoteCast`. The tally only ever comes from the indexer. `GET /profiles/:handle` gains `achievements` (finalized + final results only), supplied through an `AchievementsProvider` so `social` never imports elections. OpenAPI regenerated: it now includes the Sprint 6 social routes as well (93 paths) |
| 6 PO vote tool | `pnpm wif:vote --election <slug or id> --candidate <n> --votes <k>`, run in the PO's own terminal with `VOTER_PRIVATE_KEY` in their shell. It:<br>• runs the same `buildVotePreview` as the API<br>• prints the decoded calls, burn notice and irreversibility notice<br>• requires typing `BURN <k> WIF`<br>• sends the exact approve (skipped if the allowance already covers it), then the vote<br>• prints both explorer links |
| DB | Migration `0008_elections`:<br>• frozen candidates (insert only while the election is a draft; no update or delete)<br>• frozen rules, times, cap and ids after draft<br>• no deletes of `elections`/`chain_events`<br>• `indexer_cursors`, `election_vote_previews`, `election_vote_claims` (unique tx hash)<br>• election notification kinds<br>• least-privilege grants |
| RPC secret | `secretHttp` transport: redacts the URL from every error in the cause chain (QuickNode → `https://<quicknode>/…`, registered URLs → `https://<rpc>/…`), paces requests (`RPC_MAX_RPS`, default 15) and keeps viem's retry/backoff (incl. 429). Log scrubber redacts QuickNode URLs. `MAINNET_RPC_URL` is server-only (no `NEXT_PUBLIC_`); wallets keep the public RPC |
| Separation | New depcruise rule `elections-no-reputation-writes`; `reputation-no-economy` still passes. A source scan finds no `INSERT/UPDATE/DELETE reputation_*` in election code. **Integration test: preview, vote, bind, index, reorg and cross-check leave every `reputation_*` table byte-identical** |

## Hackathon fallback and the candidate pool (needs PO action)

Nobody can be `ranked` yet, so every candidate will come from the fallback and carry "Building track record". The local DB today has 11 users, **0 opted in to leaderboards**, **0 public theses this week** and 1 user with fills. **The CLI would currently find no candidates.** See "What I need" below.

## Test output (2026-11-11)

```text
$ pnpm typecheck                Tasks: 11 successful, 11 total
$ pnpm lint                     eslint . --max-warnings=0 (0 problems)
$ pnpm format:check             All matched files use Prettier code style!
$ pnpm depcruise                ✔ no dependency violations found (281 modules)
$ pnpm test (unit)              Test Files 23 passed · Tests 255 passed
$ pnpm test:integration         Test Files 9 passed · Tests 155 passed (14 new elections tests)
$ pnpm contracts:test           43 passed, 1 skipped (fork suite: no MAINNET_RPC_URL in CI); incl. SuiemElections 19 unit/fuzz + 3 invariants (128,000 calls, 0 reverts)
$ pnpm contracts:test:fork      4 passed (real $WIF, block 111,685,000)
$ pnpm test:e2e:extension       10 passed (49.2s)
```

Fork test output (local, `pnpm contracts:test:fork`):

```text
Ran 4 tests for test/fork/SuiemElectionsFork.t.sol:SuiemElectionsForkTest
[PASS] test_fork_cap_on_real_token() (gas: 246216)
[PASS] test_fork_token_identity() (gas: 27598)
[PASS] test_fork_vote_after_end_reverts() (gas: 124655)
[PASS] test_fork_vote_burns_real_wif() (gas: 235669)
Logs:
  fork: supply before 999995894104037093595111489
  fork: supply after  999995891104037093595111489
```

| Brief requirement | Where |
| --- | --- |
| Unit, fuzz, invariant, fork; `VoteAssetBurned` only on a supply drop | `test/SuiemElections.t.sol` (`test_vote_reverts_when_supply_does_not_fall`), `test/fork/SuiemElectionsFork.t.sol` |
| Indexer: idempotent re-runs, simulated reorg (`evm_snapshot`/`evm_revert`), chunk halving, finality transitions, `votes()` cross-check | `apps/api/test/elections.int.test.ts` (anvil with chain id 4663 and a burnable mock installed at the real $WIF address via `anvil_setCode`) |
| API: preview correctness, binding rejects wrong contract, wrong voter and replays, Idempotency-Key, privacy per `wallet_visibility`, scoping, device 403 on all 6 routes | same file |
| Candidate snapshot: fallback + labels, exclusions (demo, moderated, opted-out), demo election exception, frozen after creation | same file |
| Separation: reputation rows byte-identical; depcruise rules | same file + `.dependency-cruiser.cjs` + `apps/api/src/elections/separation.test.ts` |
| RPC secret: redaction of errors (real viem error through `secretHttp`), logs, manifest, OpenAPI; repo scan of tracked files | `packages/chain/src/rpc.test.ts`, `apps/api/src/observability/redact.test.ts`, `packages/chain/src/no-rpc-secrets.test.ts`, the manifest guard in `deploy-mainnet.ts` |

**Not covered by a test:** the binding's "wrong chain" check. It compares `getChainId()` and `tx.chainId` to 4663, but a second chain in one harness wasn't worth the time.

## Full rehearsal on a mainnet fork (no real transaction)

Anvil forked mainnet through QuickNode, with a scratch database (`suiem_rehearsal`):

1. `deploy-mainnet.ts` with the real deployer key refused without the approval token, then deployed.
2. `elections:create`: dry run listed 3 opted-in rehearsal users as "Building track record" (createElection ≈ 74k gas), then `--send`, audited.
3. 10 real $WIF were moved on the fork to a test key, then `wif:vote --candidate 2 --votes 2`: preview, simulation OK, typed `BURN 2 WIF`, exact approve, then vote.
4. Indexer tick: status `open`, tally 2 (soft), cross-check clean.
5. Time moved past the end, then `--finalize` (≈ 31k gas) and 128 blocks mined. Indexer: `finalized` / result `final`, tallies final, 3 `election_nominated` + 3 `election_result` notifications.

Estimates on real mainnet (gas price 0.02 gwei at 12:40 UTC):

| Step | Gas |
| --- | --- |
| Deploy | 1,203,120 |
| createElection | ~74k each (3 = ~225k) |
| finalize | ~31k each |

Total for the deploy, 3 creates and 3 finalizes is about 1.52M gas, **≈ 0.00003 ETH**. The deploy script requires 2× its estimate, and **0.0002 ETH is ample**.

## Deployment, elections and real mainnet transactions

**Deployed 2026-11-11 12:52 UTC** after PO approval (the PO funded the deployer with 0.0002 ETH and said "continue"). Checked onchain after the deploy:
- `owner()` is the deployer `0x7f84…0b9E`
- `WIF()` is `0x5173…4773`
- `electionCount()` is 0
- the ETH balance is 0
- the deploy cost about 0.000024 ETH, leaving the deployer 0.000176 ETH

The manifest is `packages/contracts/deployments/4663.json` and contains no RPC URL.

**Blockscout verification:** the automatic attempt was blocked by Cloudflare's bot challenge, so the contract is not verified yet. Manual verification in a browser on the contract page uses "Verify & publish" → "Solidity (Standard JSON input)":
- upload `packages/contracts/deployments/SuiemElections.standard-input.json`
- compiler `v0.8.30`
- contract `src/SuiemElections.sol:SuiemElections`
- ABI-encoded constructor args `0x0000000000000000000000007f84f0710f5d7d44ded117800198f970066c0b9e0000000000000000000000005173b8ea6923c2d40267890d45c46a3480954773`

Elections and later transactions are still pending (candidates, PO approval):

| # | What | Tx | Block |
| --- | --- | --- | --- |
| 1 | Deploy `SuiemElections` at [`0xDB6CC943E480b4E003d458705B7B35e55F69009D`](https://robinhoodchain.blockscout.com/address/0xDB6CC943E480b4E003d458705B7B35e55F69009D) | [`0x851a241f…11e2`](https://robinhoodchain.blockscout.com/tx/0x851a241f55fc0f1ce54aef618d42afd5141adbed864b89d6ba52badfde1711e2) | 111,713,485 |
| 2 | createElection "Demo round" | — | — |
| 3 | createElection "Hackathon Week 1 · Research Contributor" | — | — |
| 4 | createElection "Hackathon Week 1 · Investor" | — | — |
| 5 | PO vote(s): approve + vote | — | — |
| 6 | finalize "Demo round" | — | — |

## What was cut

- **P1.1** weekly draft scheduler, **P1.2** dispute window and **P1.3** USDG prize escrow (USDG on 4663 not verified). Cut in reverse order of value. All P0 time went to the indexer, API and an end-to-end fork rehearsal.
- **Blockscout verified-source reading:** the API returns 403 to scripted clients. Facts come from bytecode, calls, logs and fork tests instead. Automated verification after deploy may hit the same block; if so, the PO can verify in the browser with the standard JSON input (`forge verify-contract --show-standard-json-input`).
- **Slither** was not run on `SuiemElections` this sprint.

## Open questions

- **OQ-S7-01 (blocking for elections):** which database is the source of truth for elections and candidates? Today the CLI writes to the local dev DB. If Sprint 8 production starts from an empty DB, election rows must be carried over (dump/restore), or the elections created after the production DB exists. **Proposed:** deploy the contract now; create the elections against the DB that will become production.
- **OQ-S7-02 (blocking for elections):** candidates. Who opts in to leaderboards and publishes a public thesis this week (Research), and who has a reconciled paper or testnet trade (Investor)? The Demo round may list demo accounts if titled "Demo election".
- **OQ-S7-03:** the organiser's own vote contract uses a `0x…dEaD` sink, not a burn. Is it worth telling the organisers that "burned" there does not lower `totalSupply`?
- **OQ-S7-04:** add the PO as a second owner later (`transferOwnership` → `acceptOwnership`), or keep the fresh EOA until the multisig (ADR-0011)?
