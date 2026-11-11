/**
 * SuiemElections indexer (Robinhood Chain mainnet 4663).
 *
 * Each tick:
 *  1. reads the latest, `safe` and `finalized` block numbers (Arbitrum Orbit supports both tags);
 *  2. re-checks the block hash of every non-final event block; a changed or missing block marks its
 *     logs `removed` (rows are never deleted) and rewinds the scan;
 *  3. fetches logs from min(cursor, finalized + 1) to latest in chunks of `logRange` blocks (halved on
 *     a provider range error), upserts them idempotently on (chain_id, tx_hash, log_index), and marks
 *     any non-final stored log that the chain no longer returns as removed;
 *  4. recomputes finality (soft > safe > final) for every stored log;
 *  5. rebuilds `election_tallies` from non-removed `VoteCast` logs, cross-checks them against the
 *     contract's `tallies()` view (mismatch = loud error, never papered over), and moves election
 *     status / result status from events and block time, sending candidate notifications.
 * Votes and winners never touch reputation_* (ADR-0005).
 */
import { newId } from "@suiem/shared/ids";
import { suiemElectionsAbi } from "@suiem/chain/abi/elections";
import type { Pool, PoolClient } from "pg";
import { type Address, decodeEventLog, type Hex, type Log, type PublicClient } from "viem";

export type Finality = "soft" | "safe" | "final";

export interface Heads {
  latest: bigint;
  safe: bigint;
  finalized: bigint;
  /** Timestamp (seconds) of the latest block: election windows follow chain time. */
  timestamp: bigint;
}

export type IndexerLog = (
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

export interface IndexerDeps {
  pool: Pool;
  client: PublicClient;
  chainId: 4663;
  contract: Address;
  deployBlock: bigint;
  /** Blocks per eth_getLogs (INDEXER_LOG_RANGE). Halved on a range error. */
  logRange?: number;
  /** Test hook: override how heads are read (default: latest/safe/finalized block tags). */
  heads?: () => Promise<Heads>;
  log?: IndexerLog;
}

export interface TickResult {
  heads: Heads;
  fetched: number;
  removed: number;
  mismatches: { electionId: string; indexed: string[]; onchain: string[] }[];
  logRange: number;
}

const buf = (hex: string) => Buffer.from(hex.replace(/^0x/, ""), "hex");
const hexOf = (b: Buffer) => `0x${b.toString("hex")}` as Hex;
const jsonArgs = (args: unknown) =>
  JSON.parse(JSON.stringify(args, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));

export function finalityOf(block: bigint, heads: Pick<Heads, "safe" | "finalized">): Finality {
  if (block <= heads.finalized) return "final";
  if (block <= heads.safe) return "safe";
  return "soft";
}

export function isRangeError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as { details?: string }).details ?? "")}`
      : String(error);
  return /range|limit|too many|block range|10,000|exceed/i.test(text);
}

export class ElectionsIndexer {
  private logRange: number;
  private readonly log: IndexerLog;
  private readonly contractBuf: Buffer;

  constructor(private readonly deps: IndexerDeps) {
    this.logRange = deps.logRange ?? 5000;
    this.log = deps.log ?? (() => undefined);
    this.contractBuf = buf(deps.contract);
  }

  private async readHeads(): Promise<Heads> {
    if (this.deps.heads) return this.deps.heads();
    const [latest, safe, finalized] = await Promise.all([
      this.deps.client.getBlock({ blockTag: "latest" }),
      this.deps.client.getBlock({ blockTag: "safe" }),
      this.deps.client.getBlock({ blockTag: "finalized" }),
    ]);
    return {
      latest: latest.number,
      safe: safe.number,
      finalized: finalized.number,
      timestamp: latest.timestamp,
    };
  }

  /** One full indexing cycle. Safe to call repeatedly; every write is idempotent. */
  async tick(): Promise<TickResult> {
    const { pool, chainId } = this.deps;
    const heads = await this.readHeads();
    const cursor = await this.cursor();

    // 2. block-hash check for non-final event blocks.
    const nonFinal = (
      await pool.query<{ block_number: string; block_hash: Buffer }>(
        `SELECT DISTINCT block_number, block_hash FROM chain_events
          WHERE chain_id = $1 AND contract_address = $2 AND NOT removed AND finality <> 'final'`,
        [chainId, this.contractBuf],
      )
    ).rows;
    let rewind = cursor;
    let removed = 0;
    for (const row of nonFinal) {
      const n = BigInt(row.block_number);
      let hash: Hex | null;
      try {
        hash =
          n <= heads.latest ? (await this.deps.client.getBlock({ blockNumber: n })).hash : null;
      } catch {
        hash = null; // block gone (reorg / chain reset)
      }
      if (hash?.toLowerCase() !== hexOf(row.block_hash)) {
        const r = await pool.query(
          `UPDATE chain_events SET removed = true
            WHERE chain_id = $1 AND contract_address = $2 AND block_number = $3 AND block_hash = $4 AND NOT removed`,
          [chainId, this.contractBuf, n.toString(), row.block_hash],
        );
        removed += r.rowCount ?? 0;
        if (n < rewind) rewind = n;
        this.log("warn", "indexer.reorg", { kind: "block_hash_changed", count: r.rowCount ?? 0 });
      }
    }

    // 3. scan from the first non-final block (or the cursor/rewind point) to latest.
    let from = rewind;
    if (heads.finalized + 1n < from) from = heads.finalized + 1n;
    if (from < this.deps.deployBlock) from = this.deps.deployBlock;
    const logs = from <= heads.latest ? await this.fetchLogs(from, heads.latest) : [];
    const seen = new Set<string>();
    for (const l of logs) {
      if (l.removed || l.blockNumber === null || l.transactionHash === null || l.logIndex === null)
        continue;
      let decoded: { eventName: string; args: unknown };
      try {
        decoded = decodeEventLog({ abi: suiemElectionsAbi, data: l.data, topics: l.topics }) as {
          eventName: string;
          args: unknown;
        };
      } catch {
        continue; // not one of our events
      }
      seen.add(`${l.transactionHash.toLowerCase()}:${l.logIndex}`);
      await pool.query(
        `INSERT INTO chain_events (id, chain_id, contract_address, tx_hash, log_index, block_number, block_hash, event_name, args, finality, removed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
         ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE
           SET block_number = EXCLUDED.block_number, block_hash = EXCLUDED.block_hash,
               finality = EXCLUDED.finality, removed = false, args = EXCLUDED.args, event_name = EXCLUDED.event_name`,
        [
          newId(),
          chainId,
          this.contractBuf,
          buf(l.transactionHash),
          l.logIndex,
          l.blockNumber.toString(),
          buf(l.blockHash!),
          decoded.eventName,
          jsonArgs(decoded.args),
          finalityOf(l.blockNumber, heads),
        ],
      );
    }
    // Non-final logs in the scanned range that the chain no longer returns were reorged out.
    const stale = (
      await pool.query<{ tx_hash: Buffer; log_index: number }>(
        `SELECT tx_hash, log_index FROM chain_events
          WHERE chain_id = $1 AND contract_address = $2 AND NOT removed AND finality <> 'final'
            AND block_number >= $3`,
        [chainId, this.contractBuf, from.toString()],
      )
    ).rows.filter((r) => !seen.has(`${hexOf(r.tx_hash)}:${r.log_index}`));
    for (const r of stale) {
      await pool.query(
        `UPDATE chain_events SET removed = true WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3`,
        [chainId, r.tx_hash, r.log_index],
      );
      removed++;
      this.log("warn", "indexer.reorg", { kind: "log_missing", count: 1 });
    }

    // 4. finality for everything stored.
    await pool.query(
      `UPDATE chain_events
          SET finality = CASE WHEN block_number <= $3 THEN 'final' WHEN block_number <= $4 THEN 'safe' ELSE 'soft' END
        WHERE chain_id = $1 AND contract_address = $2 AND NOT removed AND finality <> 'final'`,
      [chainId, this.contractBuf, heads.finalized.toString(), heads.safe.toString()],
    );
    await pool.query(
      `INSERT INTO indexer_cursors (chain_id, contract_address, next_block) VALUES ($1, $2, $3)
       ON CONFLICT (chain_id, contract_address) DO UPDATE SET next_block = EXCLUDED.next_block, updated_at = now()`,
      [chainId, this.contractBuf, (heads.latest + 1n).toString()],
    );

    // 5. tallies, cross-check, status.
    const mismatches = await this.rebuildElections(heads);
    return { heads, fetched: logs.length, removed, mismatches, logRange: this.logRange };
  }

  private async cursor(): Promise<bigint> {
    const r = await this.deps.pool.query<{ next_block: string }>(
      "SELECT next_block FROM indexer_cursors WHERE chain_id = $1 AND contract_address = $2",
      [this.deps.chainId, this.contractBuf],
    );
    return r.rows[0] ? BigInt(r.rows[0].next_block) : this.deps.deployBlock;
  }

  /** eth_getLogs in chunks; halves the chunk on a provider range error. */
  async fetchLogs(from: bigint, to: bigint): Promise<Log[]> {
    const out: Log[] = [];
    let start = from;
    while (start <= to) {
      const end = start + BigInt(this.logRange) - 1n < to ? start + BigInt(this.logRange) - 1n : to;
      try {
        out.push(
          ...(await this.deps.client.getLogs({
            address: this.deps.contract,
            fromBlock: start,
            toBlock: end,
          })),
        );
        start = end + 1n;
      } catch (error) {
        if (isRangeError(error) && this.logRange > 1) {
          this.logRange = Math.max(1, Math.floor(this.logRange / 2));
          this.log("warn", "indexer.range_halved", { count: this.logRange });
          continue;
        }
        throw error;
      }
    }
    return out;
  }

  private async rebuildElections(heads: Heads): Promise<TickResult["mismatches"]> {
    const { pool, chainId } = this.deps;
    const elections = (
      await pool.query<{
        id: string;
        slug: string;
        onchain: string;
        starts_at: Date;
        ends_at: Date;
        status: string;
        result_status: string;
      }>(
        `SELECT id, slug, onchain_election_id::text AS onchain, starts_at, ends_at, status, result_status
           FROM elections WHERE chain_id = $1 AND contract_address = $2 AND onchain_election_id IS NOT NULL`,
        [chainId, this.contractBuf],
      )
    ).rows;
    const mismatches: TickResult["mismatches"] = [];
    for (const e of elections) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await this.rebuildOne(client, e, heads);
        await client.query("COMMIT");
        if (result) mismatches.push(result);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return mismatches;
  }

  private async rebuildOne(
    db: PoolClient,
    e: {
      id: string;
      slug: string;
      onchain: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      result_status: string;
    },
    heads: Heads,
  ): Promise<TickResult["mismatches"][number] | null> {
    const { chainId } = this.deps;
    const candidates = (
      await db.query<{ id: string; user_id: string; n: string }>(
        `SELECT id, user_id, onchain_candidate_id::text AS n FROM election_candidates
          WHERE election_id = $1 ORDER BY onchain_candidate_id`,
        [e.id],
      )
    ).rows;
    const sums = (
      await db.query<{ cand: string; votes: string; weakest: number }>(
        `SELECT args->>'candidateId' AS cand, sum((args->>'votes')::numeric)::text AS votes,
                min(CASE finality WHEN 'soft' THEN 0 WHEN 'safe' THEN 1 ELSE 2 END) AS weakest
           FROM chain_events
          WHERE chain_id = $1 AND contract_address = $2 AND NOT removed AND event_name = 'VoteCast'
            AND args->>'electionId' = $3
          GROUP BY 1`,
        [chainId, this.contractBuf, e.onchain],
      )
    ).rows;
    const byCand = new Map(sums.map((s) => [s.cand, s]));
    const names: Finality[] = ["soft", "safe", "final"];
    for (const c of candidates) {
      const s = byCand.get(c.n);
      const finality: Finality = s ? names[s.weakest]! : "final";
      const asOf = s ? heads.latest : heads.finalized;
      await db.query(
        `INSERT INTO election_tallies (election_id, candidate_id, votes, decimals, as_of_block, finality, updated_at)
         VALUES ($1, $2, $3, 0, $4, $5, now())
         ON CONFLICT (election_id, candidate_id) DO UPDATE
           SET votes = EXCLUDED.votes, as_of_block = EXCLUDED.as_of_block, finality = EXCLUDED.finality, updated_at = now()`,
        [e.id, c.id, s?.votes ?? "0", asOf.toString(), finality],
      );
    }

    // Cross-check with the contract view at the same block. Never overwrite from it.
    let mismatch: TickResult["mismatches"][number] | null = null;
    try {
      const onchain = (await this.deps.client.readContract({
        address: this.deps.contract,
        abi: suiemElectionsAbi,
        functionName: "tallies",
        args: [BigInt(e.onchain)],
        blockNumber: heads.latest,
      })) as readonly bigint[];
      const indexed = candidates.map((c) => byCand.get(c.n)?.votes ?? "0");
      const chain = onchain.map((v) => v.toString());
      if (indexed.length !== chain.length || indexed.some((v, i) => v !== chain[i])) {
        mismatch = { electionId: e.id, indexed, onchain: chain };
        this.log("error", "indexer.tally_mismatch", {
          target: e.slug,
          count: indexed.length,
          kind: `indexed=${indexed.join(",")} onchain=${chain.join(",")}`,
        });
      }
    } catch (error) {
      this.log("warn", "indexer.crosscheck_failed", {
        target: e.slug,
        kind: error instanceof Error ? error.name : "unknown",
      });
    }

    // Status from events + chain time.
    const ev = (
      await db.query<{ event_name: string; finality: Finality }>(
        `SELECT event_name, finality FROM chain_events
          WHERE chain_id = $1 AND contract_address = $2 AND NOT removed
            AND event_name IN ('ElectionCancelled', 'ElectionFinalized') AND args->>'electionId' = $3`,
        [chainId, this.contractBuf, e.onchain],
      )
    ).rows;
    const now = Number(heads.timestamp);
    const cancelled = ev.find((x) => x.event_name === "ElectionCancelled");
    const finalized = ev.find((x) => x.event_name === "ElectionFinalized");
    let status: string;
    let result: string;
    if (cancelled) {
      status = "cancelled";
      result = "none";
    } else if (finalized) {
      status = "finalized";
      result = finalized.finality === "final" ? "final" : "provisional";
    } else if (now < e.starts_at.getTime() / 1000) {
      status = "scheduled";
      result = "none";
    } else if (now < e.ends_at.getTime() / 1000) {
      status = "open";
      result = "provisional";
    } else {
      status = "closed";
      result = "provisional";
    }
    if (status !== e.status || result !== e.result_status) {
      await db.query(
        `UPDATE elections SET status = $2, result_status = $3,
                finalized_at = CASE WHEN $2 = 'finalized' THEN coalesce(finalized_at, now()) ELSE finalized_at END
          WHERE id = $1`,
        [e.id, status, result],
      );
      this.log("info", "indexer.election_status", { target: e.slug, status, phase: result });
    }
    if (["open", "closed", "finalized"].includes(status))
      await this.notify(db, e.id, candidates, "election_nominated");
    if (result === "final") await this.notify(db, e.id, candidates, "election_result");
    return mismatch;
  }

  private async notify(
    db: PoolClient,
    electionId: string,
    candidates: { user_id: string }[],
    kind: "election_nominated" | "election_result",
  ) {
    for (const c of candidates) {
      await db.query(
        `INSERT INTO notifications (id, user_id, kind, election_id, details)
         VALUES ($1, $2, $3, $4, '{}'::jsonb)
         ON CONFLICT (user_id, kind, election_id) WHERE election_id IS NOT NULL DO NOTHING`,
        [newId(), c.user_id, kind, electionId],
      );
    }
  }
}

/** Runs `tick` forever every `pollMs`, logging (redacted) failures and continuing. */
export function startIndexerLoop(indexer: ElectionsIndexer, pollMs: number, log: IndexerLog) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    if (stopped) return;
    try {
      const r = await indexer.tick();
      if (r.fetched > 0 || r.removed > 0)
        log("info", "indexer.tick", { count: r.fetched, kind: `removed=${r.removed}` });
    } catch (error) {
      log("error", "indexer.tick_failed", {
        kind: error instanceof Error ? error.name : "unknown",
      });
    }
    if (!stopped) timer = setTimeout(run, pollMs);
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
