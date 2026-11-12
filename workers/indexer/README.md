# workers/indexer

Reorg-safe indexer for `SuiemElections` on Robinhood Chain mainnet (4663).

- Reads `VoteCast` and `VoteAssetBurned` logs in chunks (`INDEXER_LOG_RANGE`); halves the range when the RPC rejects it.
- Each event is unique on `(chain_id, tx_hash, log_index)`. Re-reads recent blocks to survive reorgs and tracks finality per election (`soft` → `final`).
- Cross-checks indexed tallies against the contract's `tallies()` and logs any mismatch.
- Runs inside the API process when `INDEXER=on` (`startIndexerLoop`), or standalone via `src/main.ts`.

The indexer only reads the chain. It never holds keys or sends transactions.
