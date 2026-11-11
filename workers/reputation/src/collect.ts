/**
 * Evidence collection: reads the database and builds the engine's `Evidence` for one user.
 * Only reconciled fills (simulated + testnet demo books), frozen thesis evaluations, published
 * research and weighted votes are read. Nothing about $WIF, elections, wallets' token balances,
 * follower counts or browsing exists in this module, by design (depcruise: reputation-no-economy).
 */
import type { DbHandle } from "@suiem/db";
import { divRound } from "@suiem/shared/money";
import type { ResearchBriefV1 } from "@suiem/shared/research";
import { returnPpm } from "./engine/evaluate";
import { BENCHMARK } from "./engine/methodology";
import type { ClosedTrade, Evidence, OpenPosition, ResearchItem, Vote } from "./engine/score";

const MARK_TOLERANCE_MS = 36 * 3_600_000;
const iso = (d: Date | string) => new Date(d).toISOString();

type Q = DbHandle["pool"];

/** Nearest benchmark mark to `at` within the tolerance, or null. */
export async function benchmarkAt(
  pool: Q,
  at: Date,
): Promise<{ price: string; asOf: Date } | null> {
  const r = await pool.query<{ price: string; as_of: Date }>(
    `SELECT price, as_of FROM benchmark_marks WHERE symbol = $1
       AND as_of BETWEEN $2::timestamptz - make_interval(secs => $3) AND $2::timestamptz + make_interval(secs => $3)
     ORDER BY abs(extract(epoch FROM (as_of - $2::timestamptz))), as_of LIMIT 1`,
    [BENCHMARK.symbol, at, MARK_TOLERANCE_MS / 1000],
  );
  const row = r.rows[0];
  return row ? { price: row.price, asOf: row.as_of } : null;
}

interface FillRow {
  id: string;
  book: "simulated" | "testnet";
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  cash: string;
  filled_at: Date;
}

/** Average-cost replay (same rules as the portfolio): each sell closes a realized trade. */
async function closedTrades(pool: Q, userId: string, asOf: Date) {
  const fills = (
    await pool.query<FillRow>(
      `SELECT f.id, o.book::text AS book, i.symbol, o.side, f.quantity::text AS quantity,
              coalesce(o.filled_amount, o.quote_amount)::text AS cash, f.filled_at
         FROM fills f JOIN orders o ON o.id = f.order_id JOIN instruments i ON i.id = o.instrument_id
        WHERE o.user_id = $1 AND o.status = 'filled' AND o.book::text IN ('simulated', 'testnet')
          AND f.filled_at <= $2
        ORDER BY f.filled_at, f.id`,
      [userId, asOf],
    )
  ).rows;
  const state = new Map<string, { qty: bigint; cost: bigint; openedAt: Date | null }>();
  const trades: (Omit<ClosedTrade, "benchmarkReturnPpm"> & { opened: Date; closed: Date })[] = [];
  for (const f of fills) {
    const key = `${f.book}|${f.symbol}`;
    const s = state.get(key) ?? { qty: 0n, cost: 0n, openedAt: null };
    const q = BigInt(f.quantity);
    const cash = BigInt(f.cash);
    if (f.side === "buy") {
      if (s.qty === 0n) s.openedAt = f.filled_at;
      s.qty += q;
      s.cost += cash;
    } else if (q <= s.qty && s.qty > 0n) {
      const removed = q === s.qty ? s.cost : divRound(s.cost * q, s.qty, "halfEven");
      trades.push({
        id: f.id,
        book: f.book,
        instrument: f.symbol,
        openedAt: iso(s.openedAt ?? f.filled_at),
        closedAt: iso(f.filled_at),
        costUnits: removed.toString(),
        proceedsUnits: cash.toString(),
        opened: s.openedAt ?? f.filled_at,
        closed: f.filled_at,
      });
      s.qty -= q;
      s.cost -= removed;
      if (s.qty === 0n) s.openedAt = null;
    }
    state.set(key, s);
  }
  const out: ClosedTrade[] = [];
  for (const { opened, closed, ...t } of trades) {
    const [a, b] = [await benchmarkAt(pool, opened), await benchmarkAt(pool, closed)];
    out.push({
      ...t,
      benchmarkReturnPpm: a && b && a.asOf < b.asOf ? returnPpm(a.price, b.price).toString() : null,
    });
  }
  const open: OpenPosition[] = [...state.entries()]
    .filter(([, s]) => s.qty > 0n)
    .map(([k, s]) => {
      const [book, instrument] = k.split("|") as ["simulated" | "testnet", string];
      return { book, instrument, costUnits: s.cost.toString() };
    });
  return { trades: out, open };
}

const POST_TARGET: Record<string, Vote["target"]> = {
  thesis: "research",
  research_brief: "research",
  discussion: "discussion",
  question: "discussion",
  portfolio_snapshot: "discussion",
  learning_note: "learning_note",
};

function briefItem(
  id: string,
  createdAt: Date,
  body: string,
  brief: ResearchBriefV1 | null,
): ResearchItem {
  return {
    id,
    kind: "brief",
    createdAt: iso(createdAt),
    text: `${body}\n${brief?.summary ?? ""}`,
    sourceCount: brief?.sources.length ?? 0,
    counterarguments: (brief?.bearCase ?? []).map((c) => c.text).join(" "),
    risks: (brief?.risks ?? []).map((c) => c.text).join(" "),
    invalidation: "",
    aiAssisted: true,
  };
}

/** Published research by a user (theses not private; brief posts that are visible). */
async function researchItems(pool: Q, userId: string | null, asOf: Date, entityIds?: string[]) {
  const theses = (
    await pool.query<{
      id: string;
      user_id: string;
      entity_id: string;
      created_at: Date;
      title: string;
      rationale: string;
      evidence: unknown[];
      counterarguments: string;
      risks: string;
      invalidation: string;
      ai_assisted: boolean;
    }>(
      `SELECT t.id, t.user_id, t.entity_id, v.created_at, v.title, v.rationale, v.evidence,
              v.counterarguments, v.risks, v.invalidation, t.ai_assisted
         FROM theses t JOIN thesis_versions v ON v.thesis_id = t.id AND v.version = t.current_version
        WHERE t.visibility <> 'private' AND t.status <> 'draft' AND v.created_at <= $1
          AND ($2::uuid IS NULL OR t.user_id = $2) AND ($3::uuid[] IS NULL OR t.entity_id = ANY($3))
        ORDER BY v.created_at DESC LIMIT 1000`,
      [asOf, userId, entityIds ?? null],
    )
  ).rows;
  const briefs = (
    await pool.query<{
      id: string;
      user_id: string;
      entity_id: string | null;
      created_at: Date;
      body: string;
      brief: ResearchBriefV1 | null;
    }>(
      `SELECT p.id, p.user_id, p.entity_id, p.created_at, p.body, b.brief
         FROM posts p LEFT JOIN research_briefs b ON b.id = p.brief_id
        WHERE p.kind = 'research_brief' AND p.deleted_at IS NULL AND p.hidden_at IS NULL
          AND p.visibility <> 'private' AND p.created_at <= $1
          AND ($2::uuid IS NULL OR p.user_id = $2) AND ($3::uuid[] IS NULL OR p.entity_id = ANY($3))
        ORDER BY p.created_at DESC LIMIT 1000`,
      [asOf, userId, entityIds ?? null],
    )
  ).rows;
  return {
    items: [
      ...theses.map((t) => ({
        authorId: t.user_id,
        entityId: t.entity_id,
        item: {
          id: t.id,
          kind: "thesis" as const,
          createdAt: iso(t.created_at),
          text: `${t.title}\n${t.rationale}`,
          sourceCount: Array.isArray(t.evidence) ? t.evidence.length : 0,
          counterarguments: t.counterarguments,
          risks: t.risks,
          invalidation: t.invalidation,
          aiAssisted: t.ai_assisted,
        },
      })),
      ...briefs.map((b) => ({
        authorId: b.user_id,
        entityId: b.entity_id,
        item: briefItem(b.id, b.created_at, b.body, b.brief),
      })),
    ],
  };
}

export async function collectEvidence(db: DbHandle, userId: string, asOf: Date): Promise<Evidence> {
  const pool = db.pool;
  const u = (
    await pool.query<{ created_at: Date; is_demo: boolean }>(
      "SELECT created_at, is_demo FROM users WHERE id = $1",
      [userId],
    )
  ).rows[0];
  if (!u) throw new Error("unknown user");

  const { trades, open } = await closedTrades(pool, userId, asOf);

  const outcomes = (
    await pool.query<{
      id: string;
      thesis_id: string;
      evaluated_at: Date;
      status: "evaluated" | "unevaluable";
      correct: boolean | null;
    }>(
      // Only theses published within 24h of being written count (no cherry-picking winners
      // later, no farming decisions with private theses), at most one per company per day.
      `SELECT DISTINCT ON (t.entity_id, date_trunc('day', e.window_start)) e.id, e.thesis_id, e.evaluated_at, e.status, e.correct
         FROM thesis_evaluations e JOIN theses t ON t.id = e.thesis_id
        WHERE e.user_id = $1 AND e.evaluated_at <= $2
          AND t.published_at IS NOT NULL AND t.published_at <= e.window_start + interval '24 hours'
        ORDER BY t.entity_id, date_trunc('day', e.window_start), e.window_start, e.id`,
      [userId, asOf],
    )
  ).rows;

  const own = await researchItems(pool, userId, asOf);
  // Copy-check corpus: the most recent published research by anyone, across all companies.
  const others = await researchItems(pool, null, asOf);
  const corpus = others.items
    .filter((o) => o.authorId !== userId)
    .map((o) => ({
      id: o.item.id,
      authorId: o.authorId,
      createdAt: o.item.createdAt,
      text: o.item.text,
    }));

  const postVotes = (
    await pool.query<{
      post_id: string;
      post_kind: string;
      rater: string;
      kind: "helpful" | "not_helpful";
      created_at: Date;
    }>(
      `SELECT r.post_id, p.kind AS post_kind, r.user_id AS rater, r.kind, r.created_at
         FROM reactions r JOIN posts p ON p.id = r.post_id
        WHERE p.user_id = $1 AND r.kind IN ('helpful', 'not_helpful') AND p.deleted_at IS NULL
          AND p.hidden_at IS NULL AND r.created_at <= $2`,
      [userId, asOf],
    )
  ).rows;
  const commentVotes = (
    await pool.query<{
      comment_id: string;
      is_answer: boolean;
      rater: string;
      kind: "helpful" | "not_helpful";
      created_at: Date;
    }>(
      `SELECT cr.comment_id, (p.kind = 'question' AND c.parent_id IS NULL) AS is_answer,
              cr.user_id AS rater, cr.kind, cr.created_at
         FROM comment_reactions cr JOIN comments c ON c.id = cr.comment_id JOIN posts p ON p.id = c.post_id
        WHERE c.user_id = $1 AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND cr.created_at <= $2`,
      [userId, asOf],
    )
  ).rows;
  const votes: Vote[] = [
    ...postVotes.map((v) => ({
      targetId: v.post_id,
      target: POST_TARGET[v.post_kind] ?? ("discussion" as const),
      raterId: v.rater,
      kind: v.kind,
      createdAt: iso(v.created_at),
    })),
    ...commentVotes.map((v) => ({
      targetId: v.comment_id,
      target: v.is_answer ? ("answer" as const) : ("comment" as const),
      raterId: v.rater,
      kind: v.kind,
      createdAt: iso(v.created_at),
    })),
  ];
  const raterIds = [...new Set(votes.map((v) => v.raterId))];
  const raters = raterIds.length
    ? (
        await pool.query<{
          id: string;
          created_at: Date;
          is_demo: boolean;
          research_since: Date | null;
        }>(
          `SELECT u.id, u.created_at, u.is_demo,
                  least(
                    (SELECT min(t.published_at) FROM theses t
                      WHERE t.user_id = u.id AND t.status <> 'draft' AND t.visibility <> 'private'),
                    (SELECT min(p.created_at) FROM posts p
                      WHERE p.user_id = u.id AND p.kind = 'research_brief' AND p.deleted_at IS NULL
                        AND p.hidden_at IS NULL AND p.visibility <> 'private')
                  ) AS research_since
             FROM users u WHERE u.id = ANY($1)`,
          [raterIds],
        )
      ).rows.map((r) => ({
        id: r.id,
        createdAt: iso(r.created_at),
        isDemo: r.is_demo,
        researchSince: r.research_since ? iso(r.research_since) : null,
      }))
    : [];

  const given = (
    await pool.query<{ author: string; created_at: Date }>(
      `SELECT p.user_id AS author, r.created_at FROM reactions r JOIN posts p ON p.id = r.post_id
        WHERE r.user_id = $1 AND r.kind = 'helpful' AND r.created_at <= $2
       UNION ALL
       SELECT c.user_id AS author, cr.created_at FROM comment_reactions cr JOIN comments c ON c.id = cr.comment_id
        WHERE cr.user_id = $1 AND cr.kind = 'helpful' AND cr.created_at <= $2`,
      [userId, asOf],
    )
  ).rows;

  const activity = (
    await pool.query<{ at: Date }>(
      `SELECT f.filled_at AS at FROM fills f JOIN orders o ON o.id = f.order_id WHERE o.user_id = $1 AND f.filled_at <= $2
       UNION ALL SELECT v.created_at FROM thesis_versions v JOIN theses t ON t.id = v.thesis_id WHERE t.user_id = $1 AND v.created_at <= $2
       UNION ALL SELECT created_at FROM posts WHERE user_id = $1 AND deleted_at IS NULL AND created_at <= $2
       UNION ALL SELECT created_at FROM comments WHERE user_id = $1 AND deleted_at IS NULL AND created_at <= $2`,
      [userId, asOf],
    )
  ).rows.map((r) => iso(r.at));

  return {
    subject: { userId, createdAt: iso(u.created_at), isDemo: u.is_demo },
    asOf: iso(asOf),
    trades,
    openPositions: open,
    thesisOutcomes: outcomes.map((o) => ({
      id: o.id,
      thesisId: o.thesis_id,
      evaluatedAt: iso(o.evaluated_at),
      status: o.status,
      correct: o.correct,
    })),
    research: own.items.map((i) => i.item),
    corpus,
    votes,
    raters,
    helpfulGiven: given.map((g) => ({ authorId: g.author, createdAt: iso(g.created_at) })),
    activity,
  };
}
