/**
 * Reputation jobs: benchmark marks, thesis evaluation at horizon end, and snapshot writes.
 * Snapshots are written only when the canonical result changes (hash), and the loop runs at
 * least hourly. All scoring goes through the pure engine.
 */
import type { DbHandle } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { createHash } from "node:crypto";
import { collectEvidence } from "./collect";
import { evaluateThesis } from "./engine/evaluate";
import {
  ACTIVE_METHODOLOGY,
  BENCHMARK,
  type Methodology,
  METHODOLOGIES,
} from "./engine/methodology";
import { canonicalJson, score, type Snapshot } from "./engine/score";
import { benchmarkAt } from "./collect";

export interface Quote {
  price: string;
  asOf: Date;
  source: string;
}
/** Latest quote for a ticker (Finnhub in production, fixtures in tests). */
export type QuoteSource = (ticker: string) => Promise<Quote>;

export interface JobDeps {
  db: DbHandle;
  quotes: QuoteSource | null;
  now: () => Date;
  log?: (event: string, fields: Record<string, unknown>) => void;
  methodology?: Methodology;
}

const LATE_LIMIT_MS = 72 * 3_600_000;

/** Hash of the snapshot without its timestamps: unchanged evidence → unchanged hash. */
export function snapshotHash(s: Snapshot): Buffer {
  const { asOf: _a, evaluationPeriod, ...rest } = s;
  return createHash("sha256")
    .update(canonicalJson({ ...rest, evaluationPeriod: { from: evaluationPeriod.from } }))
    .digest();
}

export interface StoredSnapshot {
  id: string;
  snapshot: Snapshot;
  computedAt: Date;
  previous: Snapshot | null;
  written: boolean;
}

/** Recompute one user's score; writes a new snapshot only if it changed. */
export async function recomputeUser(deps: JobDeps, userId: string): Promise<StoredSnapshot> {
  const m = deps.methodology ?? METHODOLOGIES[ACTIVE_METHODOLOGY];
  const now = deps.now();
  const evidence = await collectEvidence(deps.db, userId, now);
  const snap = score(evidence, m);
  const hash = snapshotHash(snap);
  const pool = deps.db.pool;
  const latest = (
    await pool.query<{
      id: string;
      components: Snapshot;
      snapshot_hash: Buffer | null;
      computed_at: Date;
    }>(
      `SELECT id, components, snapshot_hash, computed_at FROM reputation_snapshots
        WHERE user_id = $1 AND methodology_version = $2 ORDER BY computed_at DESC, id DESC LIMIT 1`,
      [userId, m.version],
    )
  ).rows[0];
  if (latest?.snapshot_hash && Buffer.compare(latest.snapshot_hash, hash) === 0) {
    const prev = latest.components;
    return {
      id: latest.id,
      snapshot: prev,
      computedAt: latest.computed_at,
      previous: null,
      written: false,
    };
  }
  const id = newId();
  await pool.query(
    `INSERT INTO reputation_snapshots (id, user_id, methodology_version, maturity, suiem_score,
       investor_score, contribution_score, components, computed_at, snapshot_hash, previous_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      userId,
      m.version,
      snap.maturity,
      snap.suiemScore,
      snap.investorScore,
      snap.contributionScore,
      canonicalJson(snap),
      now,
      hash,
      latest?.id ?? null,
    ],
  );
  return {
    id,
    snapshot: snap,
    computedAt: now,
    previous: latest?.components ?? null,
    written: true,
  };
}

/** Records the SPY benchmark mark (idempotent per provider timestamp). */
export async function recordBenchmark(deps: JobDeps): Promise<void> {
  if (!deps.quotes) return;
  const q = await deps.quotes(BENCHMARK.symbol);
  await deps.db.pool.query(
    `INSERT INTO benchmark_marks (id, symbol, price, as_of, source) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol, as_of) DO NOTHING`,
    [newId(), BENCHMARK.symbol, q.price, q.asOf, q.source],
  );
}

interface DueThesis {
  thesis_id: string;
  user_id: string;
  direction: "bullish" | "bearish" | "neutral";
  horizon_days: number;
  created_at: Date;
  price_context: {
    symbol?: string;
    price?: string;
    asOf?: string;
    benchmark?: { symbol: string; price: string; asOf: string } | null;
  } | null;
}

/**
 * Evaluates every thesis whose horizon has ended, using ONLY the frozen version 1. Later
 * versions never change the evaluation (append-only table, one row per thesis).
 */
export async function evaluateDueTheses(deps: JobDeps): Promise<number> {
  const m = deps.methodology ?? METHODOLOGIES[ACTIVE_METHODOLOGY];
  const now = deps.now();
  const pool = deps.db.pool;
  const due = (
    await pool.query<DueThesis>(
      `SELECT t.id AS thesis_id, t.user_id, v.direction, v.horizon_days, v.created_at, v.price_context
         FROM theses t JOIN thesis_versions v ON v.thesis_id = t.id AND v.version = 1
        WHERE v.created_at + make_interval(days => v.horizon_days) <= $1
          AND NOT EXISTS (SELECT 1 FROM thesis_evaluations e WHERE e.thesis_id = t.id)
        ORDER BY v.created_at LIMIT 200`,
      [now],
    )
  ).rows;
  let n = 0;
  for (const t of due) {
    const windowEnd = new Date(t.created_at.getTime() + t.horizon_days * 86_400_000);
    const pc = t.price_context;
    const symbol = pc?.symbol ?? null;
    const benchStart = pc?.benchmark?.price
      ? { price: pc.benchmark.price, asOf: new Date(pc.benchmark.asOf) }
      : await benchmarkAt(pool, t.created_at);
    let end: Quote | null = null;
    let benchEnd: Quote | null = null;
    let reason: string | null = null;
    if (now.getTime() - windowEnd.getTime() > LATE_LIMIT_MS) {
      reason =
        "The horizon ended more than 72 hours before evaluation, so no end price was observed";
    } else if (!deps.quotes) {
      continue; // no market data configured: try again on the next run
    } else {
      try {
        if (symbol) end = await deps.quotes(symbol);
        benchEnd = await deps.quotes(BENCHMARK.symbol);
      } catch {
        continue; // provider down: retry next run (within the 72h limit)
      }
    }
    const r = reason
      ? ({ status: "unevaluable", reason } as const)
      : evaluateThesis({
          direction: t.direction,
          startPrice: pc?.price ?? null,
          endPrice: end?.price ?? null,
          benchmarkStart: benchStart?.price ?? null,
          benchmarkEnd: benchEnd?.price ?? null,
          neutralBandPpm: m.investor.neutralBandPpm,
        });
    const id = newId();
    const inserted = await pool.query(
      `INSERT INTO thesis_evaluations (id, thesis_id, thesis_version, user_id, methodology, status, direction,
         horizon_days, window_start, window_end, symbol, start_price, end_price, benchmark_symbol,
         benchmark_start, benchmark_end, instrument_return_ppm, benchmark_return_ppm, relative_return_ppm,
         correct, reason, sources, evaluated_at)
       VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (thesis_id) DO NOTHING`,
      [
        id,
        t.thesis_id,
        t.user_id,
        m.version,
        r.status,
        t.direction,
        t.horizon_days,
        t.created_at,
        windowEnd,
        symbol,
        pc?.price ?? null,
        end?.price ?? null,
        BENCHMARK.symbol,
        benchStart?.price ?? null,
        benchEnd?.price ?? null,
        r.status === "evaluated" ? r.instrumentReturnPpm.toString() : null,
        r.status === "evaluated" ? r.benchmarkReturnPpm.toString() : null,
        r.status === "evaluated" ? r.relativeReturnPpm.toString() : null,
        r.status === "evaluated" ? r.correct : null,
        r.status === "unevaluable" ? r.reason : null,
        JSON.stringify({
          instrument: end ? { source: end.source, asOf: end.asOf.toISOString() } : null,
          benchmark: BENCHMARK.label,
          benchmarkStartAsOf: benchStart?.asOf.toISOString() ?? null,
          benchmarkEnd: benchEnd
            ? { source: benchEnd.source, asOf: benchEnd.asOf.toISOString() }
            : null,
          startAsOf: pc?.asOf ?? null,
        }),
        now,
      ],
    );
    if (!inserted.rowCount) continue;
    n++;
    if (r.status === "evaluated") {
      await pool.query(
        `INSERT INTO reputation_evidence (id, user_id, component, source_type, source_id, value, methodology_version, observed_at)
         VALUES ($1, $2, 'thesis_outcome', 'thesis_evaluation', $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [newId(), t.user_id, id, r.correct ? "1" : "0", m.version, now],
      );
    }
    await pool.query(
      `INSERT INTO notifications (id, user_id, kind, thesis_id, details) VALUES ($1, $2, 'thesis_evaluated', $3, $4)`,
      [
        newId(),
        t.user_id,
        t.thesis_id,
        JSON.stringify({ status: r.status, correct: r.status === "evaluated" ? r.correct : null }),
      ],
    );
    await recomputeUser(deps, t.user_id);
    deps.log?.("thesis evaluated", { thesisId: t.thesis_id, status: r.status });
  }
  return n;
}

/** Recomputes every active user (hackathon scale). */
export async function recomputeAll(deps: JobDeps): Promise<{ users: number; written: number }> {
  const ids = (
    await deps.db.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE status = 'active' ORDER BY id",
    )
  ).rows;
  let written = 0;
  for (const { id } of ids) if ((await recomputeUser(deps, id)).written) written++;
  return { users: ids.length, written };
}

/** One full pass: benchmark mark, due evaluations, all snapshots. */
export async function runReputationPass(deps: JobDeps) {
  await recordBenchmark(deps).catch((e: unknown) =>
    deps.log?.("benchmark mark failed", { error: (e as Error).message }),
  );
  const evaluated = await evaluateDueTheses(deps);
  const r = await recomputeAll(deps);
  deps.log?.("reputation pass", { evaluated, ...r });
  return { evaluated, ...r };
}

/** In-process loop (API boot): every `intervalMs` (≤ 1 hour). Returns a stop function. */
export function startReputationJobs(deps: JobDeps, intervalMs = 15 * 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runReputationPass(deps);
    } catch (e) {
      deps.log?.("reputation pass failed", { error: (e as Error).message });
    } finally {
      running = false;
    }
  };
  void tick();
  const t = setInterval(() => void tick(), Math.min(intervalMs, 3_600_000));
  return () => clearInterval(t);
}
