/**
 * Candidate snapshot for a new election. Taken ONCE at creation and stored
 * frozen in election_candidates + elections.rules; never recomputed.
 *
 * - "Research Contributor" ← leaderboard `research?period=week`; "Investor" ← `investors?period=week`.
 * - Up to 8 candidates. If the board has fewer than 2 ranked rows (hackathon: nobody has 3 days of
 *   activity yet), fill the remaining slots from opted-in users with ≥1 public published thesis in the
 *   last 7 days (Research) or ≥1 reconciled testnet/simulated trade (Investor), labelled
 *   "Building track record".
 * - Always: appear_in_leaderboards, status 'active', no open moderation report against the user or
 *   their content, and not is_demo, except in a "Demo election".
 * Reads leaderboards and activity only. Never writes reputation_*.
 */
import type { Pool } from "pg";
import { ACTIVE_METHODOLOGY, queryLeaderboard } from "../social/leaderboard";

export type ElectionCategory = "research_contributor" | "investor";
export const BOARD_FOR: Record<ElectionCategory, "research" | "investors"> = {
  research_contributor: "research",
  investor: "investors",
};
export const MAX_CANDIDATES = 8;
const MIN_RANKED = 2;

export interface CandidateSnapshot {
  userId: string;
  handle: string;
  displayName: string | null;
  board: "research" | "investors";
  rank: number | null;
  score: string | null;
  label: "ranked" | "building_track_record";
  methodologyVersion: string;
}

const NO_OPEN_MODERATION = `NOT EXISTS (
  SELECT 1 FROM moderation_reports r
   WHERE r.status = 'open' AND (
         (r.target_type = 'user' AND r.target_id = u.id)
      OR (r.target_type = 'post' AND r.target_id IN (SELECT id FROM posts WHERE user_id = u.id))
      OR (r.target_type = 'comment' AND r.target_id IN (SELECT id FROM comments WHERE user_id = u.id))))`;

export async function snapshotCandidates(
  pool: Pick<Pool, "query">,
  category: ElectionCategory,
  opts: { demo: boolean },
): Promise<CandidateSnapshot[]> {
  const board = BOARD_FOR[category];
  const ranked = await queryLeaderboard(pool, board, {
    period: "week",
    showDemo: opts.demo,
    viewerId: null,
  });
  const clean = new Set(
    ranked.length
      ? (
          await pool.query<{ id: string }>(
            `SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) AND ${NO_OPEN_MODERATION}`,
            [ranked.map((r) => r.user_id)],
          )
        ).rows.map((r) => r.id)
      : [],
  );
  const picked: CandidateSnapshot[] = ranked
    .filter((r) => clean.has(r.user_id))
    .slice(0, MAX_CANDIDATES)
    .map((r, i) => ({
      userId: r.user_id,
      handle: r.handle,
      displayName: r.display_name,
      board,
      rank: i + 1,
      score: r.score,
      label: "ranked",
      methodologyVersion: r.methodology_version,
    }));
  if (picked.length >= MIN_RANKED) return picked;

  const activity =
    board === "research"
      ? `(SELECT count(*) FROM theses t WHERE t.user_id = u.id AND t.visibility = 'public'
            AND t.status = 'published' AND t.published_at > now() - interval '7 days')`
      : `(SELECT count(*) FROM fills f JOIN orders o ON o.id = f.order_id
           WHERE o.user_id = u.id AND o.book::text IN ('testnet', 'simulated'))`;
  const fallback = (
    await pool.query<{ id: string; handle: string; display_name: string | null }>(
      `SELECT u.id, u.handle, u.display_name, ${activity} AS n
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE p.appear_in_leaderboards AND u.status = 'active'
          AND ($1::boolean OR NOT u.is_demo)
          AND NOT (u.id = ANY($2::uuid[]))
          AND ${NO_OPEN_MODERATION}
          AND ${activity} > 0
        ORDER BY n DESC, u.handle ASC
        LIMIT $3`,
      [opts.demo, picked.map((p) => p.userId), MAX_CANDIDATES - picked.length],
    )
  ).rows;
  return [
    ...picked,
    ...fallback.map((r) => ({
      userId: r.id,
      handle: r.handle,
      displayName: r.display_name,
      board,
      rank: null,
      score: null,
      label: "building_track_record" as const,
      methodologyVersion: ACTIVE_METHODOLOGY,
    })),
  ];
}
