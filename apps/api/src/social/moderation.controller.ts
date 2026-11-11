import { Controller, Inject, Param, Req } from "@nestjs/common";
import type { DbHandle } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { uuidParam } from "@suiem/shared/schemas";
import {
  communitySlug,
  reportRequest,
  resolveAppealRequest,
  resolveReportRequest,
} from "@suiem/shared/social";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { DB } from "../tokens";
import { REPUTATION, type ReputationRuntime } from "./reputation.runtime";
import { SocialService } from "./social.service";

const uid = (req: FastifyRequest) => req.suiem.session!.userId;
const statusQuery = z.object({ status: z.enum(["open", "all"]).default("open") }).strict();
const id404 = (id: string, what: string) => {
  if (!uuidParam.safeParse(id).success) throw new ApiError("NOT_FOUND", `Unknown ${what}`);
};

/**
 * Moderation queue and appeals (Sprint 6 P1). Moderator role only; the role is set by the
 * `pnpm user:role` CLI and is never writable through the API. Every action is audited.
 */
@Controller()
export class ModerationController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(REPUTATION) private readonly rep: ReputationRuntime,
  ) {}

  private get pool() {
    return this.db.pool;
  }

  private async moderator(req: FastifyRequest): Promise<string> {
    const me = uid(req);
    const r = await this.pool.query<{ role: string }>(
      "SELECT role FROM users WHERE id = $1 AND status = 'active'",
      [me],
    );
    if (r.rows[0]?.role !== "moderator") {
      await this.audit.write({
        actorType: "user",
        actorUserId: me,
        action: "moderation.access_denied",
        outcome: "denied",
        requestId: req.suiem.requestId,
      });
      throw new ApiError("FORBIDDEN", "Moderators only");
    }
    return me;
  }

  // ---- Reports ----------------------------------------------------------------------------

  @Route({
    method: "POST",
    path: "/comments/:id/report",
    summary: "Report a comment to moderators",
    tags: ["posts"],
    auth: "user",
    body: reportRequest,
    status: 201,
  })
  async reportComment(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "comment");
    const me = uid(req);
    const c = (
      await this.pool.query<{ post_id: string }>(
        "SELECT post_id FROM comments WHERE id = $1 AND deleted_at IS NULL AND hidden_at IS NULL",
        [id],
      )
    ).rows[0];
    if (!c) throw new ApiError("NOT_FOUND", "Unknown comment");
    await this.social.visiblePost(me, c.post_id);
    const b = req.body as z.infer<typeof reportRequest>;
    await this.pool.query(
      `INSERT INTO moderation_reports (id, reporter_id, target_type, target_id, reason, note)
       VALUES ($1, $2, 'comment', $3, $4, $5) ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [newId(), me, id, b.reason, b.note ?? null],
    );
    return { reported: true };
  }

  @Route({
    method: "GET",
    path: "/moderation/reports",
    summary: "Moderation queue (moderators only)",
    tags: ["moderation"],
    auth: "user",
    query: statusQuery,
  })
  async reports(@Req() req: FastifyRequest) {
    await this.moderator(req);
    const { status } = req.query as z.infer<typeof statusQuery>;
    const rows = (
      await this.pool.query<{
        id: string;
        target_type: "post" | "comment" | "user";
        target_id: string;
        reason: string;
        note: string | null;
        status: string;
        created_at: Date;
        resolved_at: Date | null;
        resolution_reason: string | null;
        reporter: string;
        reports_on_target: string;
        excerpt: string | null;
        author: string | null;
        hidden: boolean | null;
      }>(
        `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.status, r.created_at, r.resolved_at,
                r.resolution_reason, ru.handle AS reporter,
                (SELECT count(*) FROM moderation_reports x WHERE x.target_type = r.target_type AND x.target_id = r.target_id) AS reports_on_target,
                coalesce(left(p.body, 280), left(c.body, 280)) AS excerpt,
                coalesce(pa.handle, ca.handle, tu.handle) AS author,
                coalesce(p.hidden_at, c.hidden_at) IS NOT NULL AS hidden
           FROM moderation_reports r JOIN users ru ON ru.id = r.reporter_id
           LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
           LEFT JOIN users pa ON pa.id = p.user_id
           LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
           LEFT JOIN users ca ON ca.id = c.user_id
           LEFT JOIN users tu ON r.target_type = 'user' AND tu.id = r.target_id
          WHERE $1 = 'all' OR r.status = 'open'
          ORDER BY r.created_at LIMIT 200`,
        [status],
      )
    ).rows;
    return {
      items: rows.map((r) => ({
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        resolvedAt: r.resolved_at?.toISOString() ?? null,
        resolutionReason: r.resolution_reason,
        reporter: r.reporter,
        reportsOnTarget: Number(r.reports_on_target),
        target: { excerpt: r.excerpt, author: r.author, hidden: r.hidden ?? false },
      })),
    };
  }

  @Route({
    method: "POST",
    path: "/moderation/reports/:id/resolve",
    summary:
      "Hide the reported post/comment with a reason code, or dismiss; resolves every open report on it and notifies reporters",
    tags: ["moderation"],
    auth: "user",
    body: resolveReportRequest,
  })
  async resolveReport(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = await this.moderator(req);
    id404(id, "report");
    const b = req.body as z.infer<typeof resolveReportRequest>;
    const report = (
      await this.pool.query<{
        target_type: "post" | "comment" | "user";
        target_id: string;
        status: string;
      }>("SELECT target_type, target_id, status FROM moderation_reports WHERE id = $1", [id])
    ).rows[0];
    if (!report) throw new ApiError("NOT_FOUND", "Unknown report");
    if (report.status !== "open") throw new ApiError("CONFLICT", "This report is already resolved");
    if (b.action === "hide" && report.target_type === "user")
      throw new ApiError(
        "VALIDATION_FAILED",
        "Users can't be hidden; hide their posts or comments",
      );
    const outcome = b.action === "hide" ? "actioned" : "dismissed";
    const resolution = b.note ? `${b.reason}: ${b.note}` : b.reason;
    let author: string | null = null;
    const client = await this.pool.connect();
    let reporters: string[];
    try {
      await client.query("BEGIN");
      if (b.action === "hide") {
        const table = report.target_type === "post" ? "posts" : "comments";
        const r = await client.query<{ user_id: string }>(
          `UPDATE ${table} SET hidden_at = coalesce(hidden_at, now()), hidden_reason = $2 WHERE id = $1 RETURNING user_id`,
          [report.target_id, b.reason],
        );
        author = r.rows[0]?.user_id ?? null;
      }
      reporters = (
        await client.query<{ reporter_id: string }>(
          `UPDATE moderation_reports SET status = $3, resolved_by = $4, resolved_at = now(), resolution_reason = $5
            WHERE target_type = $1 AND target_id = $2 AND status = 'open' RETURNING reporter_id`,
          [report.target_type, report.target_id, outcome, me, resolution],
        )
      ).rows.map((r) => r.reporter_id);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    await this.audit.write({
      actorType: "user",
      actorUserId: me,
      action: b.action === "hide" ? "moderation.content_hidden" : "moderation.report_dismissed",
      outcome: "success",
      targetType: report.target_type,
      targetId: report.target_id,
      requestId: req.suiem.requestId,
      details: { reasonCode: b.reason, reports: reporters.length },
    });
    for (const r of reporters)
      await this.social.notify({
        userId: r,
        kind: "report_outcome",
        details: { outcome, reason: b.reason, targetType: report.target_type },
      });
    if (author) await this.social.rescore(author);
    return { status: outcome, reportsResolved: reporters.length };
  }

  // ---- Appeals ----------------------------------------------------------------------------

  @Route({
    method: "GET",
    path: "/moderation/appeals",
    summary: "Score appeals (moderators only)",
    tags: ["moderation"],
    auth: "user",
    query: statusQuery,
  })
  async appeals(@Req() req: FastifyRequest) {
    await this.moderator(req);
    const { status } = req.query as z.infer<typeof statusQuery>;
    const rows = (
      await this.pool.query<{
        id: string;
        handle: string;
        reason: string;
        status: string;
        snapshot_id: string | null;
        created_at: Date;
        resolution_note: string | null;
      }>(
        `SELECT a.id, u.handle, a.reason, a.status, a.snapshot_id, a.created_at, a.resolution_note
           FROM reputation_appeals a JOIN users u ON u.id = a.user_id
          WHERE $1 = 'all' OR a.status = 'open' ORDER BY a.created_at LIMIT 200`,
        [status],
      )
    ).rows;
    return {
      items: rows.map((a) => ({
        id: a.id,
        handle: a.handle,
        reason: a.reason,
        status: a.status,
        snapshotId: a.snapshot_id,
        createdAt: a.created_at.toISOString(),
        resolutionNote: a.resolution_note,
      })),
    };
  }

  @Route({
    method: "POST",
    path: "/moderation/appeals/:id/resolve",
    summary:
      "Mark an appeal reviewed, or recalculate (re-runs the deterministic engine; audited). Not your own",
    tags: ["moderation"],
    auth: "user",
    body: resolveAppealRequest,
  })
  async resolveAppeal(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = await this.moderator(req);
    id404(id, "appeal");
    const b = req.body as z.infer<typeof resolveAppealRequest>;
    const a = (
      await this.pool.query<{ user_id: string; status: string }>(
        "SELECT user_id, status FROM reputation_appeals WHERE id = $1",
        [id],
      )
    ).rows[0];
    if (!a) throw new ApiError("NOT_FOUND", "Unknown appeal");
    if (a.user_id === me) throw new ApiError("FORBIDDEN", "You can't resolve your own appeal");
    if (a.status !== "open") throw new ApiError("CONFLICT", "This appeal is already resolved");
    let recalculation: { before: string | null; after: string; changed: boolean } | null = null;
    if (b.action === "recalculate") {
      const before =
        (
          await this.pool.query<{ id: string }>(
            "SELECT id FROM reputation_snapshots WHERE user_id = $1 ORDER BY computed_at DESC, id DESC LIMIT 1",
            [a.user_id],
          )
        ).rows[0]?.id ?? null;
      const s = await this.rep.recompute(a.user_id);
      recalculation = { before, after: s.id, changed: s.written };
    }
    const status = b.action === "recalculate" ? "recalculated" : "reviewed";
    await this.pool.query(
      `UPDATE reputation_appeals SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4
        WHERE id = $1 AND status = 'open'`,
      [id, status, me, b.note],
    );
    await this.audit.write({
      actorType: "user",
      actorUserId: me,
      action:
        b.action === "recalculate"
          ? "reputation.appeal_recalculated"
          : "reputation.appeal_reviewed",
      outcome: "success",
      targetType: "reputation_appeal",
      targetId: id,
      requestId: req.suiem.requestId,
      details: recalculation
        ? {
            snapshotBefore: recalculation.before,
            snapshotAfter: recalculation.after,
            changed: recalculation.changed,
          }
        : { decision: "reviewed" },
    });
    await this.social.notify({
      userId: a.user_id,
      kind: "appeal_outcome",
      details: { status, note: b.note },
    });
    return { status, recalculation };
  }

  // ---- Communities ------------------------------------------------------------------------

  @Route({
    method: "GET",
    path: "/communities",
    summary: "Sector communities with member counts (membership is a feed filter only)",
    tags: ["communities"],
    auth: "optional",
  })
  async communities(@Req() req: FastifyRequest) {
    const rows = (
      await this.pool.query<{
        slug: string;
        name: string;
        description: string;
        sectors: string[];
        members: string;
        joined: boolean;
      }>(
        `SELECT c.slug, c.name, c.description, c.sectors,
                (SELECT count(*) FROM community_members m WHERE m.community_id = c.id) AS members,
                EXISTS (SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = $1::uuid) AS joined
           FROM communities c ORDER BY c.name`,
        [req.suiem.session?.userId ?? null],
      )
    ).rows;
    return { items: rows.map((r) => ({ ...r, members: Number(r.members) })) };
  }

  private async community(slug: string) {
    if (!communitySlug.safeParse(slug).success)
      throw new ApiError("NOT_FOUND", "Unknown community");
    const r = await this.pool.query<{ id: string }>("SELECT id FROM communities WHERE slug = $1", [
      slug,
    ]);
    if (!r.rows[0]) throw new ApiError("NOT_FOUND", "Unknown community");
    return r.rows[0].id;
  }

  @Route({
    method: "POST",
    path: "/communities/:slug/membership",
    summary: "Join a community",
    tags: ["communities"],
    auth: "user",
  })
  async join(@Req() req: FastifyRequest, @Param("slug") slug: string) {
    const c = await this.community(slug);
    await this.pool.query(
      "INSERT INTO community_members (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [c, uid(req)],
    );
    return { joined: true };
  }

  @Route({
    method: "DELETE",
    path: "/communities/:slug/membership",
    summary: "Leave a community",
    tags: ["communities"],
    auth: "user",
  })
  async leave(@Req() req: FastifyRequest, @Param("slug") slug: string) {
    const c = await this.community(slug);
    await this.pool.query(
      "DELETE FROM community_members WHERE community_id = $1 AND user_id = $2",
      [c, uid(req)],
    );
    return { joined: false };
  }
}
