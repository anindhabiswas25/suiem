import { Controller, Inject, Param, Req } from "@nestjs/common";
import type { DbHandle } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import {
  ACTIVE_METHODOLOGY,
  BENCHMARK,
  METHODOLOGIES,
  NEVER_COUNTED,
  NOT_A_RATING,
  PERFORMANCE_LABEL,
} from "@suiem/reputation";
import {
  appealRequest,
  handleParam,
  leaderboardParam,
  leaderboardQuery,
} from "@suiem/shared/social";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { DB } from "../tokens";
import { BOARDS, queryLeaderboard } from "./leaderboard";
import { ReputationView } from "./reputation.view";
import { SocialService } from "./social.service";

/** bigint-safe JSON for the methodology document. */
const plain = (v: unknown): unknown =>
  typeof v === "bigint"
    ? v.toString()
    : Array.isArray(v)
      ? v.map(plain)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
        : v;

export const INTEGRITY_RULES = [
  "Votes and $WIF never affect the Suiem Score: there is no data path from elections, token balances or burns to the score.",
  "Helpful votes are weighted for rater diversity: one vote per rater per author per day; new accounts and raters with no published research count at half weight; reciprocal helpful rings are discounted; demo accounts' votes count zero.",
  "Near-duplicate research (word-shingle similarity ≥ 80% with earlier research by anyone) earns zero quality.",
  "Only theses published within 24 hours of being written count, at most one per company per day, and each is evaluated on its frozen first version.",
  "Missing or unverifiable data is never treated as success: a component without enough data scores zero, never a neutral midpoint.",
  "AI-assisted research counts at half weight: it is allowed, but it is not proof of expertise.",
  "Rate limits: 10 posts per hour, 30 comments per hour, 50 helpful votes per day; you can't react to your own post.",
  "Every snapshot stores its components, inputs summary, methodology version and maturity. Appeals re-run the same deterministic engine and are audited.",
];

@Controller()
export class ReputationController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ReputationView) private readonly view: ReputationView,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Route({
    method: "GET",
    path: "/profiles/:handle/reputation",
    summary: "Score card (you, or users who opted in to leaderboards)",
    tags: ["reputation"],
    auth: "optional",
  })
  async reputation(@Req() req: FastifyRequest, @Param("handle") handle: string) {
    if (!handleParam.safeParse(handle).success) throw new ApiError("NOT_FOUND", "Unknown profile");
    const u = await this.social.userByHandle(handle);
    if (!u) throw new ApiError("NOT_FOUND", "Unknown profile");
    const rel = await this.social.relation(req.suiem.session?.userId ?? null, u.id);
    if (rel.blockedByOwner) throw new ApiError("NOT_FOUND", "Unknown profile");
    const optedIn = (
      await this.db.pool.query<{ a: boolean }>(
        "SELECT appear_in_leaderboards AS a FROM profiles WHERE user_id = $1",
        [u.id],
      )
    ).rows[0]?.a;
    if (!rel.self && !optedIn) throw new ApiError("FORBIDDEN", "This score is private");
    return this.view.forUser(u.id);
  }

  @Route({
    method: "GET",
    path: "/reputation/methodology",
    summary: "Formulas, weights, thresholds (v1-hackathon and v1), benchmark and integrity rules",
    tags: ["reputation"],
    auth: "public",
  })
  methodology() {
    return {
      active: ACTIVE_METHODOLOGY,
      methodologies: plain(Object.values(METHODOLOGIES)),
      benchmark: BENCHMARK,
      performanceLabel: PERFORMANCE_LABEL,
      disclaimer: NOT_A_RATING,
      neverCounted: NEVER_COUNTED,
      integrity: INTEGRITY_RULES,
    };
  }

  @Route({
    method: "POST",
    path: "/reputation/appeals",
    summary: "Appeal your score (a moderator reviews it or re-runs the deterministic engine)",
    tags: ["reputation"],
    auth: "user",
    body: appealRequest,
    status: 201,
  })
  async appeal(@Req() req: FastifyRequest) {
    const me = req.suiem.session!.userId;
    const b = req.body as z.infer<typeof appealRequest>;
    if (b.snapshotId) {
      const own = await this.db.pool.query(
        "SELECT 1 FROM reputation_snapshots WHERE id = $1 AND user_id = $2",
        [b.snapshotId, me],
      );
      if (!own.rowCount) throw new ApiError("NOT_FOUND", "Unknown snapshot");
    }
    const open = await this.db.pool.query(
      "SELECT 1 FROM reputation_appeals WHERE user_id = $1 AND status = 'open'",
      [me],
    );
    if (open.rowCount) throw new ApiError("CONFLICT", "You already have an open appeal");
    const id = newId();
    await this.db.pool.query(
      "INSERT INTO reputation_appeals (id, user_id, snapshot_id, reason) VALUES ($1, $2, $3, $4)",
      [id, me, b.snapshotId ?? null, b.reason],
    );
    await this.audit.write({
      actorType: "user",
      actorUserId: me,
      action: "reputation.appeal_filed",
      outcome: "success",
      targetType: "reputation_appeal",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    return { id, status: "open" };
  }

  @Route({
    method: "GET",
    path: "/leaderboards/:board",
    summary:
      "Opt-in leaderboard of ranked profiles (suiem | research | investors). Candidate pools for weekly elections",
    tags: ["reputation"],
    auth: "optional",
    query: leaderboardQuery,
  })
  async leaderboard(@Req() req: FastifyRequest, @Param("board") board: string) {
    const parsed = leaderboardParam.safeParse(board);
    if (!parsed.success) throw new ApiError("NOT_FOUND", "Unknown leaderboard");
    const b = BOARDS[parsed.data];
    const q = req.query as z.infer<typeof leaderboardQuery>;
    const rows = await queryLeaderboard(this.db.pool, parsed.data, {
      period: q.period,
      showDemo: q.showDemo,
      viewerId: req.suiem.session?.userId ?? null,
    });
    return {
      board: parsed.data,
      title: b.title,
      label: b.label,
      period: q.period,
      methodologyVersion: ACTIVE_METHODOLOGY,
      performanceLabel: PERFORMANCE_LABEL,
      badge: METHODOLOGIES[ACTIVE_METHODOLOGY].badge,
      showDemo: q.showDemo,
      rows: rows.map((r, i) => ({
        rank: i + 1,
        userId: r.user_id,
        handle: r.handle,
        displayName: r.display_name,
        isDemo: r.is_demo,
        score: r.score,
        suiemScore: r.suiem_score,
        investorScore: r.investor_score,
        contributionScore: r.contribution_score,
        maturity: r.maturity,
        methodologyVersion: r.methodology_version,
        computedAt: r.computed_at.toISOString(),
      })),
    };
  }
}
