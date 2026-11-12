You are the staff engineer for Suiem. Sprint 6 (social + reputation) is DONE and APPROVED as a **backend** sprint. The PO re-ran the checks: typecheck, 244 unit tests, 141 integration tests and depcruise are all green. The web UI for Sprint 6 is deferred to Sprint 8 by PO instruction (S8-02).

This is **SPRINT 7 of 8: the $WIF economy on mainnet**. Budget about 7 hours. This is the world is flat hackathon build, and **submissions close 12 Nov 2026, 17:30 UTC**. This sprint meets the hackathon's core rule: **real $WIF transactions on Robinhood Chain mainnet (4663)**.

**Backend first, as in Sprint 6.** Build the contract, tests, deploy tooling, indexer and API. **Do not build web pages.** The elections UI, including the irreversible-burn review screen, moves to Sprint 8 with the rest of the deferred UI. Finish **P0** first. Do **P1** only if time allows, and list anything cut in the report.

**Work in this single session. Do not spawn subagents or fan out parallel agents.**

## Read first

- `docs/HACKATHON_PLAN.md`, and `docs/sprints/SPRINT_6.md` (especially "Note for Sprint 7: drawing election candidates from the leaderboards")
- `docs/sprints/SPRINT_5.md`: the deploy tooling, manifest, Blockscout verification and key handling pattern to mirror
- ADR-0005 §2–3 (BURN vs SINK semantics, voting design) and ADR-0010 §2 (mainnet exception rules)
- `docs/VERIFIED_FACTS.md` §6b (W-11…W-16)
- PRD §12.3 (contract events: an event is named "burned" only if supply actually decreases)
- migration `0001_foundation.sql`: `elections`, `election_candidates`, `chain_events`, `election_tallies`, `audit_logs`
- `packages/config/chains/` (`FEATURE_NETWORK`, mainnet chain definition), `packages/contracts/` (Foundry setup, `DeployTestnet.s.sol`, `scripts/deploy-testnet.ts`)

Work on branch `hackathon/main`. Make small conventional commits. Do not push.

## RPC: the PO's QuickNode subscription (Build plan)

- Use the PO's **QuickNode** endpoint as the mainnet RPC for fork tests, the deploy, the indexer and server-side reads.
- **The PO adds the URL to `.env` themselves** as `MAINNET_RPC_URL=` (and optionally `TESTNET_RPC_URL=` for 46630). Ask for it and **never ask them to paste it into chat**.
- **The URL contains the auth token, so it is a secret:**
  - Keep it in `.env` only. It is never committed, logged or written to a manifest, report, error response or test snapshot.
  - viem errors include the RPC URL. Wrap the transport so messages and logs redact it to `https://<quicknode>/…`, and add a test for that.
  - The web app must never get it: no `NEXT_PUBLIC_` variable. Wallets keep using the public RPC. Only the API, the indexer and scripts use QuickNode.
- **Check it first.** `eth_chainId` must return `0x1237` (4663). If QuickNode doesn't serve Robinhood Chain mainnet, stop and tell the PO, then fall back to `https://rpc.mainnet.chain.robinhood.com`.
- **Respect plan limits:**
  - Chunk `eth_getLogs` by a configurable block range (`INDEXER_LOG_RANGE`, default 5000; halve it on a range error).
  - Back off on HTTP 429.
  - Use a configurable request rate.

## S7-01 first (blocks the contract design)

Check onchain before writing `SuiemElections`, and record the results as VERIFIED_FACTS **W-16** (and amend W-15) with tx hashes or links:

1. `eth_getCode` for $WIF `0x5173b8eA6923c2d40267890D45C46a3480954773`. Read its verified ABI and source on mainnet Blockscout and look for:
   - `burn(uint256)` and `burnFrom(address,uint256)`
   - fee-on-transfer, blocklist, pause or hook behaviour
   - whether it is a proxy (record the implementation address)
   - `decimals() == 18`
   - the `symbol()` and `name()` it returns
2. Do the same for the organiser vote contract `0xd1b711917a405782da2ec650a0ee4711a76a5535`. Find out how `vote(uint256,uint256,uint256)` destroys $WIF (`burnFrom`? transfer then `burn`? transfer to a sink?). Find one real `Voted` transaction and check that `totalSupply` dropped.
3. Pick the mechanic from what you find:
   - **`burnFrom` exists and lowers supply:** `vote` calls `WIF.burnFrom(voter, amount)`, and the voter approves `SuiemElections`. Emit `VoteAssetBurned`.
   - **Only `burn` exists:** in the same call, `transferFrom(voter → this, amount)` then `burn(amount)`. The contract balance must be zero at the end of every call. Emit `VoteAssetBurned`.
   - **Neither exists:** stop and ask the PO before using SINK mode to a provably irrecoverable address. The event is then `VoteAssetTransferredToSink`, and the UI copy must never say "burned".
4. **Lookalike defence:** the $WIF address is a hard-coded constant (checksummed) in `packages/config`. At startup the API and indexer assert `chainId == 4663`, `decimals == 18`, and the expected symbol. Nothing accepts a token address from user input.

## PO decisions (resolve OQ-P-04 for the hackathon)

- **Weight:** 1 $WIF = 1 vote, **whole tokens only** (`amount % 1e18 == 0`). Linear, not quadratic.
- **Per-wallet cap: 25 votes per wallet per election**, enforced onchain and set per election at creation. This limits whale influence. The PO's test wallet holds about 128 $WIF.
- **Eligibility:**
  - Onchain, anyone may vote. The contract can't see Suiem accounts.
  - Results show every valid onchain vote. A "Suiem member" marker appears when the voter's address is a SIWE-linked wallet whose owner allows `wallet_visibility`; otherwise the voter is shown only as a shortened address, because it is already public onchain.
  - No account-age rule during the hackathon.
- **Votes are final:** they can't be changed, refunded or reversed. A cancelled election keeps its burned tokens burned. The API and docs state this before any vote is built.
- **Creation and administration:**
  - Elections are created by the contract **owner** (a fresh deployer EOA, `Ownable2Step`) through a CLI script. A multisig is deferred (ADR-0011).
  - The owner can create an election, add candidates **before `startTime`** and cancel **before `startTime`**. That is all.
  - There is no withdraw, no upgrade, no pause of an open election and no way to change a running election.
  - `finalize` can be called by anyone after `endTime`.
- **Candidates:**
  - At creation, freeze **up to 8** candidates per election from the Sprint 6 boards: "Research Contributor" uses `research?period=week` and "Investor" uses `investors?period=week`. Record board, rank, score and methodology version in `elections.rules`. Never recompute the list after creation.
  - **Hackathon fallback:** nobody can be `ranked` yet (the threshold is 3 days of activity). If a board has fewer than 2 ranked rows, fill the remaining slots, up to 8, from users who opted in to leaderboards and have at least one **public published thesis** in the last 7 days (Research), or at least one reconciled testnet/simulated trade (Investor).
  - Fallback candidates carry the label **"Building track record"**, and the election carries **"Hackathon season"**.
  - Eligibility in every case: `appear_in_leaderboards`, `status = 'active'`, no open moderation action, and not `is_demo`. The exception is an election whose title and rules say **"Demo election"**, which may list demo accounts.
- **Nothing personal goes onchain.** Candidates are sequential `uint256` ids per election, mapped off-chain in `election_candidates.onchain_candidate_id`.
- **Schedule:**
  - The first real round is **"Hackathon Week 1"**, with two elections (Research Contributor, Investor). Each opens shortly after deploy and closes **18 Nov 2026 17:00 UTC**, after the live window ends.
  - Also create one short **"Demo round"** election (about 2 hours) so the full open → close → finalize → results flow shows up with real transactions before submission.
- **Prizes:** the spotlight only, meaning a winner badge on the profile that is an **achievement, not score evidence**. No USDG or other prize this sprint unless P1 time remains.
- **Separation stays:**
  - Election code may read leaderboards. Reputation code never reads elections, $WIF or chain code.
  - Votes and winners never write to `reputation_*`.
  - Add the depcruise rule `elections-no-reputation-writes`, and a test that casting votes leaves every reputation snapshot byte-identical.
- **Mainnet transactions need approval. These steps need explicit PO approval in chat:**
  - deploying the contract
  - creating the first elections
  - every later owner transaction

  The approvals may be bundled into one request. Votes are cast by the PO themselves.

## P0: build first

### 1. `SuiemElections.sol` (`packages/contracts/src/`)

- **Minimal, immutable code:** no proxy and no `delegatecall`. Use `Ownable2Step` and `ReentrancyGuard`. Use `SafeERC20` where it applies. Set `WIF` as an `immutable` in the constructor.
- **Storage:** `elections[id] = {startTime, endTime, capPerWallet, candidateCount, status(Scheduled|Cancelled|Finalized), totalVotes}`, `votes[id][candidateId]`, `votedBy[id][voter]`.
- **Functions:**
  - `createElection(start, end, cap, candidateCount)` (owner)
  - `cancel(id)` (owner, before start)
  - `vote(id, candidateId, votes)`: the window is enforced by `block.timestamp`. It checks the candidate exists, the amount is whole and within the cap, then burns according to S7-01 and updates the tally.
  - `finalize(id)` (anyone, after end)
  - views for tallies, remaining cap and status
- **Events (PRD §12.3):** `ElectionCreated`, `CandidateAdded` (or candidate count in `ElectionCreated`, but be consistent), `VoteCast(electionId, candidateId, voter, votes)`, `VoteAssetBurned(electionId, candidateId, voter, amount)`, `ElectionFinalized(electionId, totalVotes)`, `ElectionCancelled`.
- **The contract holds no funds:** it never holds $WIF or ETH between calls. It has no `receive` and no `payable` functions.
- Write NatSpec on everything. Add a short security note in `packages/contracts/README.md`: trust assumptions, what the owner can and can't do, and the irreversibility of votes.

### 2. Contract tests

- **Unit tests against a burnable mock:** window edges (start and end seconds), cap, whole-token rule, unknown candidate, cancelled election, finalize timing, only the owner can create or cancel, the 2-step ownership transfer, and the event and argument values.
- **Fuzz tests:** random amounts and voters never break the cap. The total of tallies always equals the total burned.
- **Invariant tests:** the contract's $WIF and ETH balances are always 0. `sum(votes) == totalVotes` for every election.
- **Fork tests (`anvil --fork-url $MAINNET_RPC_URL` at a pinned block, against the REAL $WIF):**
  - Impersonate a real holder: the PO wallet `0xc7b6D8350DaAf397B83B2a66dd69a76804a79A37` or another holder found on Blockscout.
  - Approve and vote, then assert that **`totalSupply` decreased by exactly the amount**, the voter's balance decreased, and the contract balance is 0.
  - Check the cap and a vote after end on the real token.
  - Add a CI-skippable tag, because fork tests need the secret RPC.
- **Event-name test:** `VoteAssetBurned` is emitted only when supply actually drops (the fork test asserts it).

### 3. Mainnet deploy tooling (approval gate)

- Add `script/DeployMainnet.s.sol` and `scripts/deploy-mainnet.ts`, mirroring the testnet pair. They must:
  - refuse unless `chainid == 4663`
  - refuse unless `CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL`
  - refuse if the deployer has less ETH than the estimated cost × 2
  - read the key from `MAINNET_DEPLOYER_PRIVATE_KEY` and never print it
  - write `deployments/4663.json` (address, tx hashes, block, git SHA, compiler, constructor args, `WIF` address), **without the RPC URL**
  - verify on mainnet Blockscout
- **Key generation:** generate a fresh deployer key with `out=$(cast wallet new 2>&1)`. **Never echo `$out`.** Write it to `.env`, print only `cast wallet address`. In Sprint 5, two keys leaked through stderr, so don't repeat that.
- **`pnpm elections:create`** is a CLI script for owner transactions. It:
  - snapshots candidates from the boards (with the fallback above)
  - writes the `elections` and `election_candidates` rows
  - shows a dry-run summary (chain, contract, times, cap, candidates, gas estimate) and sends only with `--send`
  - writes an `audit_logs` entry
- **STOP for PO approval before the first mainnet transaction.** Post in chat:
  - the S7-01 findings
  - the contract source hash
  - the fork-test output
  - the deployer address
  - the estimated gas for the deploy plus 3 elections
  - the exact elections and candidate lists to create

  The PO then funds the deployer, about **0.0002 ETH**, from their test wallet.

### 4. Indexer (`workers/indexer`, currently a placeholder)

- **Poll** `eth_getLogs` for the `SuiemElections` address from the deploy block, chunked, via QuickNode.
- **Store each log in `chain_events`:**
  - idempotent on `UNIQUE (chain_id, tx_hash, log_index)`
  - with `block_hash`
  - with `finality` from the block tags: `soft` above `safe`, `safe` up to the `safe` tag, `final` up to `finalized`. Robinhood Chain is an Arbitrum Orbit chain; confirm it supports the tags and record what you find.
- **Reorg safety:**
  - Keep a cursor per (chain, contract) in a new `indexer_cursors` table.
  - On each poll, re-fetch block hashes for the non-final range. Mark logs whose block hash changed as `removed = true` and re-index that range.
  - Never delete rows.
- **Tallies:**
  - Rebuild `election_tallies` from non-removed `VoteCast` events, recording `as_of_block` and the weakest finality included.
  - Each cycle, **cross-check** against the contract's `votes()` view and log any mismatch loudly. Never paper over it.
- **Election status:**
  - Move `elections.status` from the onchain events and `block.timestamp`: `scheduled → open → closed → finalized`, or `cancelled`.
  - Mark a result **"final"** only after `ElectionFinalized` is itself at `final` finality. Until then it is "provisional".
- **Runtime:** the indexer runs inline in the API process by default (`INDEXER=inline`, like the reputation jobs), or as a standalone entry point. It polls every 10–15 seconds.
- **Notifications:** when a candidate's election opens they get `election_nominated`. When a result is finalized, every candidate gets `election_result`.

### 5. API (`/api/v1`, Zod, rate-limited; device tokens get 403 on all of these)

- `GET /elections?status=` and `GET /elections/:slug` return:
  - rules, times and status
  - the network badge **"Mainnet · real $WIF"**
  - the contract address with an explorer link
  - candidates (handle and display name per privacy settings, board, rank, the "Building track record" label)
  - tallies with finality and `as_of_block`
  - the per-wallet cap
  - the irreversibility notice
- `GET /elections/:slug/votes?cursor=` returns indexed votes: shortened voter address, candidate, votes, tx hash and explorer link, finality, and the "Suiem member" marker only per `wallet_visibility`.
- **`POST /elections/:slug/vote/preview {candidateId, votes}`** (session; the user must have a linked wallet) returns:
  - the voter's $WIF balance, current allowance and remaining cap
  - the **exact** `approve(SuiemElections, amount)` calldata (exact amount, never unlimited) and the `vote` calldata, both decoded for display
  - an `eth_call` simulation result
  - `chainId: 4663`
  - the plain-language notice: "You are about to burn N real $WIF. Burned tokens are destroyed and cannot be refunded, even if the election is cancelled. Votes never affect your Suiem Score. $WIF has no promise of value or return."
  - a `previewHash`, as in Sprint 5
- `POST /elections/:slug/votes {txHash, previewHash}` (Idempotency-Key) binds the tx to the user after checking the receipt (to, chain, event, voter == linked wallet). The tally itself comes **only** from the indexer.
- `GET /me/votes` returns the user's own vote history.
- Winner badges: `GET /profiles/:handle` gains an `achievements` list (for example "Research Contributor · Hackathon Week 1 winner"), shown only for finalized elections. It is never a reputation input.
- Regenerate the OpenAPI document.

### 6. PO real-vote tool

- Write `scripts/wif-vote.ts` (`pnpm wif:vote --election <slug> --candidate <n> --votes <k>`) for the PO to run **in their own terminal** with `VOTER_PRIVATE_KEY` in their env. **You never see or handle that key.**
- The script:
  - calls the same preview logic
  - prints the burn notice and the decoded calls
  - requires typing `BURN <k> WIF` to continue
  - sends `approve` (exact amount) then `vote`
  - prints both tx hashes and explorer links
- **Exit check:** the PO casts 1–2 real votes. The indexer records them at `final` finality, the tallies match the contract view, and the Demo round finalizes with a result.

## P1: if time allows (cut in this order: last first)

1. A weekly scheduler job proposes the next week's two elections as **drafts** (candidate snapshot plus dry-run). Sending still needs the owner CLI and PO approval.
2. Dispute window: a `disputed` flag on a vote (moderator-only, audited), excluded from the displayed result by a published rule. The tokens stay burned, and the onchain tally is still shown alongside.
3. The optional prefunded USDG prize escrow (ADR-0010 table). **Only** if USDG is verified on 4663, and only as a separate contract with its own fork tests. Most likely cut it.

## Tests (must pass)

- Foundry: unit, fuzz, invariant, and fork tests against real $WIF (fork tests run locally with `MAINNET_RPC_URL`; CI skips them with a visible message).
- Indexer integration (anvil, plus the local `SuiemElections` deployed with a burnable mock):
  - idempotent re-runs
  - a **simulated reorg** (`anvil_revert` / snapshot) marks removed logs and fixes the tallies
  - chunking and halving on range errors
  - finality transitions
  - the cross-check with `votes()`
- API:
  - preview correctness (exact approve, decoded calls, cap, balance, simulation)
  - tx binding rejects a wrong chain, contract or voter, and replays
  - privacy of voter identity per `wallet_visibility`
  - scoping
  - device tokens get 403 on every new route
- **Separation:** voting leaves every `reputation_*` row and snapshot unchanged (integration). The `elections-no-reputation-writes` and `reputation-no-economy` depcruise rules pass.
- RPC secret: redaction test (no QuickNode token in logs, errors, manifest or OpenAPI). A repo scan in CI fails if `quiknode.pro` appears in tracked files.
- Candidate snapshot: frozen after creation, the fallback with labels, exclusions (demo, moderated, opted-out).
- All existing checks stay green: typecheck, lint, format, depcruise, unit, integration, extension E2E, and Foundry.

## Hard rules

- **No mainnet transaction without explicit PO approval in chat.** You never touch the PO's voter key.
- Never print, log or commit a private key or the QuickNode URL.
- `SuiemElections` holds no funds, has no upgradeability and no admin withdrawal, and can't change a running election.
- Never call it "burned" unless `totalSupply` dropped. Never describe $WIF as an investment or promise value.
- Votes and $WIF never affect the Suiem Score.
- No automatic buying, no Banchor loops, no Robinhood name or logo. `trading.live` stays hard-off.
- No web UI this sprint (deferred to Sprint 8).

## Deliverables

- `docs/sprints/SPRINT_7.md` must include:
  - S7-01 findings
  - the contract design and trust assumptions
  - test output, including the fork test
  - the deployment (address, Blockscout link, tx hashes)
  - the elections created
  - **a table of every real mainnet tx hash** (deploy, creates, votes, finalize), ready to paste into the submission
  - what was cut
  - open questions
- `packages/contracts/deployments/4663.json`, the contracts README security note, VERIFIED_FACTS W-15/W-16 updated, OQ-P-04 and OQ-H-04 resolved in `OPEN_QUESTIONS.md`, and an ADR-0005 addendum (hackathon voting rules).
- Update `docs/HACKATHON_PLAN.md`, adding to S8-02 the elections pages: list, detail with live tally and finality, the irreversible-burn review screen (preview → approve → vote → indexed), my votes, results, and the winner badge.

Finish with:
1. What works now (with the mainnet tx links)
2. Test summary
3. What was cut
4. What I need for Sprint 8:
   - Vercel and Railway access (or the PO's preferred hosts)
   - the repo visibility decision (OQ-H-01)
   - who records the demo video
   - whether to start a real multi-day demo account today (OQ-S6-03)

Then STOP and wait for my approval before Sprint 8.
