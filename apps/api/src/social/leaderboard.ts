/**
 * Leaderboard query (Sprint 6), shared by `GET /leaderboards/:board` and the election candidate
 * snapshot (Sprint 7). Reads reputation snapshots only; it never reads elections or $WIF.
 */
import { ACTIVE_METHODOLOGY } from "@suiem/reputation";
import type { Pool } from "pg";

export const BOARDS = {
  suiem: { column: "suiem_score", title: "Suiem Score", label: "50/50 investor + contribution" },
  research: {
    column: "contribution_score",
    title: "Research Contributors",
    label: "Community contribution component",
  },
  investors: {
    column: "investor_score",
    title: "Investors",
    label: "Investor component · simulated / testnet",
  },
} as const;
export type Board = keyof typeof BOARDS;

export interface LeaderboardRow {
  user_id: string;
  handle: string;
  display_name: string | null;
  is_demo: boolean;
  score: string;
  suiem_score: string;
  investor_score: string;
  contribution_score: string;
  maturity: "ranked";
  methodology_version: string;
  computed_at: Date;
}

export async function queryLeaderboard(
  pool: Pick<Pool, "query">,
  board: Board,
  opts: { period: "week" | "all"; showDemo: boolean; viewerId: string | null },
): Promise<LeaderboardRow[]> {
  const b = BOARDS[board];
  return (
    await pool.query<LeaderboardRow>(
      `WITH latest AS (
         SELECT DISTINCT ON (s.user_id) s.*
           FROM reputation_snapshots s WHERE s.methodology_version = $1
          ORDER BY s.user_id, s.computed_at DESC, s.id DESC)
       SELECT l.user_id, u.handle, u.display_name, u.is_demo, l.${b.column}::text AS score,
              l.suiem_score::text, l.investor_score::text, l.contribution_score::text, l.maturity,
              l.methodology_version, l.computed_at
         FROM latest l JOIN users u ON u.id = l.user_id JOIN profiles p ON p.user_id = l.user_id
        WHERE l.maturity = 'ranked' AND p.appear_in_leaderboards AND u.status = 'active'
          AND ($2::boolean OR NOT u.is_demo)
          AND NOT EXISTS (SELECT 1 FROM blocks bl WHERE bl.blocker_id = l.user_id AND bl.blocked_id = $4::uuid)
          AND ($3::text = 'all' OR EXISTS (
                SELECT 1 FROM posts x WHERE x.user_id = l.user_id AND x.created_at > now() - interval '7 days'
                UNION ALL SELECT 1 FROM comments x WHERE x.user_id = l.user_id AND x.created_at > now() - interval '7 days'
                UNION ALL SELECT 1 FROM thesis_versions v JOIN theses t ON t.id = v.thesis_id
                           WHERE t.user_id = l.user_id AND v.created_at > now() - interval '7 days'
                UNION ALL SELECT 1 FROM fills f JOIN orders o ON o.id = f.order_id
                           WHERE o.user_id = l.user_id AND f.filled_at > now() - interval '7 days'))
        ORDER BY l.${b.column} DESC, u.handle ASC
        LIMIT 100`,
      [ACTIVE_METHODOLOGY, opts.showDemo, opts.period, opts.viewerId],
    )
  ).rows;
}
