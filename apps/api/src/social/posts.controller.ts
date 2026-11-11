import { Controller, Inject, Param, Req } from "@nestjs/common";
import type { DbHandle } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import type { ResearchBriefV1 } from "@suiem/shared/research";
import { uuidParam } from "@suiem/shared/schemas";
import {
  createCommentRequest,
  createPostRequest,
  type CreatePostRequest,
  feedQuery,
  feedResponse,
  postView,
  reactionRequest,
  reportRequest,
  type Visibility,
} from "@suiem/shared/social";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { LIMITS, RateLimiter } from "../infra/rate-limit";
import { CLOCK, type Clock, DB } from "../tokens";
import { decodeCursor, encodeCursor, PAGE_SIZE, rank } from "./feed";
import { allocationSnapshot } from "./profiles.controller";
import {
  NOT_MUTED_SQL,
  POST_COLUMNS,
  type PostRow,
  SocialService,
  VISIBLE_POST_SQL,
} from "./social.service";

const RANK: Record<Visibility, number> = { private: 0, followers: 1, public: 2 };
const uid = (req: FastifyRequest) => req.suiem.session!.userId;
const id404 = (id: string, what: string) => {
  if (!uuidParam.safeParse(id).success) throw new ApiError("NOT_FOUND", `Unknown ${what}`);
};

/** Posts, comments, reactions, bookmarks, reports, feed and notifications (PRD §9). */
@Controller()
export class PostsController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get pool() {
    return this.db.pool;
  }

  private async entityUuid(canonical: string | undefined): Promise<string | null> {
    if (!canonical) return null;
    const r = await this.pool.query<{ id: string }>(
      "SELECT id FROM entities WHERE canonical_id = $1",
      [canonical],
    );
    if (!r.rows[0]) throw new ApiError("NOT_FOUND", "Unknown company");
    return r.rows[0].id;
  }

  // ---- Posts ----------------------------------------------------------------------------------

  @Route({
    method: "POST",
    path: "/posts",
    summary:
      "Publish to the feed (visibility is required; labels Sourced / AI-assisted / Simulated are set by the server)",
    tags: ["posts"],
    auth: "user",
    body: createPostRequest,
    response: postView,
    status: 201,
  })
  async create(@Req() req: FastifyRequest) {
    const me = uid(req);
    await this.limiter.consume(LIMITS.postsPerUser, me);
    const b = req.body as CreatePostRequest;
    let entityId = await this.entityUuid(b.entityId);
    let attachment: Record<string, unknown> | null = null;
    let sourced = false;
    let aiAssisted = false;
    let thesisId: string | null = null;
    let briefId: string | null = null;

    if (b.kind === "thesis") {
      if (!b.thesisId) throw new ApiError("VALIDATION_FAILED", "thesisId is required");
      const t = (
        await this.pool.query<{
          id: string;
          entity_id: string;
          visibility: Visibility;
          ai_assisted: boolean;
          title: string;
          direction: string;
          horizon_days: number;
          current_version: number;
          evidence: unknown[];
          entity_name: string;
          canonical_id: string;
        }>(
          `SELECT t.id, t.entity_id, t.visibility, t.ai_assisted, v.title, v.direction, v.horizon_days,
                  t.current_version, v.evidence, e.name AS entity_name, e.canonical_id
             FROM theses t JOIN thesis_versions v ON v.thesis_id = t.id AND v.version = t.current_version
             JOIN entities e ON e.id = t.entity_id
            WHERE t.id = $1 AND t.user_id = $2`,
          [b.thesisId, me],
        )
      ).rows[0];
      if (!t) throw new ApiError("NOT_FOUND", "Unknown thesis");
      // A post can never be more visible than the thesis it shares.
      if (RANK[b.visibility] > RANK[t.visibility])
        throw new ApiError(
          "VALIDATION_FAILED",
          `This thesis is ${t.visibility}; publish it more widely first, or share it as ${t.visibility}`,
        );
      thesisId = t.id;
      entityId = t.entity_id;
      sourced = Array.isArray(t.evidence) && t.evidence.length > 0;
      aiAssisted = t.ai_assisted;
      attachment = {
        type: "thesis",
        thesisId: t.id,
        title: t.title,
        direction: t.direction,
        horizonDays: t.horizon_days,
        version: t.current_version,
        entityId: t.canonical_id,
        entityName: t.entity_name,
        evidenceCount: Array.isArray(t.evidence) ? t.evidence.length : 0,
      };
    } else if (b.kind === "research_brief") {
      if (!b.briefId) throw new ApiError("VALIDATION_FAILED", "briefId is required");
      const r = (
        await this.pool.query<{ id: string; entity_id: string | null; brief: ResearchBriefV1 }>(
          "SELECT id, entity_id, brief FROM research_briefs WHERE id = $1 AND user_id = $2",
          [b.briefId, me],
        )
      ).rows[0];
      if (!r) throw new ApiError("NOT_FOUND", "Unknown brief");
      briefId = r.id;
      entityId = r.entity_id;
      aiAssisted = true; // a brief is always AI-generated; the user can't remove the label
      sourced = r.brief.sources.length > 0;
      attachment = {
        type: "research_brief",
        briefId: r.id,
        entityId: r.brief.entity.canonicalId,
        entityName: r.brief.entity.name,
        summary: r.brief.summary,
        dataFreshness: r.brief.dataFreshness,
        sources: r.brief.sources
          .slice(0, 8)
          .map((s) => ({ title: s.title, url: s.url, publisher: s.publisher })),
      };
    } else if (b.kind === "portfolio_snapshot") {
      const snap = await allocationSnapshot(this.db, me, false);
      if (!snap.books.length)
        throw new ApiError("VALIDATION_FAILED", "You have no open positions to share");
      attachment = { type: "portfolio_snapshot", ...snap };
    } else if (b.thesisId || b.briefId) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Only thesis and research_brief posts link a thesis or brief",
      );
    }

    const id = newId();
    await this.pool.query(
      `INSERT INTO posts (id, user_id, kind, body, entity_id, thesis_id, brief_id, visibility, ai_assisted, sponsored, sourced, attachment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11)`,
      [
        id,
        me,
        b.kind,
        b.body,
        entityId,
        thesisId,
        briefId,
        b.visibility,
        aiAssisted,
        sourced,
        attachment ? JSON.stringify(attachment) : null,
      ],
    );
    await this.social.rescore(me);
    const [v] = await this.social.views(me, [await this.social.visiblePost(me, id)]);
    return v;
  }

  @Route({
    method: "GET",
    path: "/posts/:id",
    summary: "A post with its comments",
    tags: ["posts"],
    auth: "optional",
  })
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    const viewer = req.suiem.session?.userId ?? null;
    const post = await this.social.visiblePost(viewer, id);
    const [view] = await this.social.views(viewer, [post]);
    const comments = (
      await this.pool.query<{
        id: string;
        parent_id: string | null;
        body: string;
        created_at: Date;
        user_id: string;
        handle: string;
        display_name: string | null;
        is_demo: boolean;
        helpful: string;
        not_helpful: string;
        mine: "helpful" | "not_helpful" | null;
      }>(
        `SELECT c.id, c.parent_id, c.body, c.created_at, c.user_id, u.handle, u.display_name, u.is_demo,
                (SELECT count(*) FROM comment_reactions r WHERE r.comment_id = c.id AND r.kind = 'helpful') AS helpful,
                (SELECT count(*) FROM comment_reactions r WHERE r.comment_id = c.id AND r.kind = 'not_helpful') AS not_helpful,
                (SELECT r.kind FROM comment_reactions r WHERE r.comment_id = c.id AND r.user_id = $2::uuid) AS mine
           FROM comments c JOIN users u ON u.id = c.user_id
          WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.hidden_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = c.user_id AND b.blocked_id = $2::uuid)
                                                   OR (b.blocker_id = $2::uuid AND b.blocked_id = c.user_id))
          ORDER BY c.created_at, c.id LIMIT 500`,
        [id, viewer],
      )
    ).rows;
    return {
      post: view,
      comments: comments.map((c) => ({
        id: c.id,
        parentId: c.parent_id,
        body: c.body,
        createdAt: c.created_at.toISOString(),
        author: { id: c.user_id, handle: c.handle, displayName: c.display_name, isDemo: c.is_demo },
        counts: { helpful: Number(c.helpful), notHelpful: Number(c.not_helpful) },
        viewer: { reaction: c.mine, isAuthor: c.user_id === viewer },
      })),
    };
  }

  @Route({
    method: "DELETE",
    path: "/posts/:id",
    summary: "Delete your post (soft delete: hidden everywhere)",
    tags: ["posts"],
    auth: "user",
  })
  async remove(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    const r = await this.pool.query(
      "UPDATE posts SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [id, uid(req)],
    );
    if (!r.rowCount) throw new ApiError("NOT_FOUND", "Unknown post");
    await this.social.rescore(uid(req));
    return { deleted: true };
  }

  // ---- Comments -------------------------------------------------------------------------------

  @Route({
    method: "POST",
    path: "/posts/:id/comments",
    summary: "Comment or reply (one level of nesting)",
    tags: ["posts"],
    auth: "user",
    body: createCommentRequest,
    status: 201,
  })
  async comment(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    const me = uid(req);
    await this.limiter.consume(LIMITS.commentsPerUser, me);
    const post = await this.social.visiblePost(me, id);
    if (await this.social.blockedEitherWay(me, post.user_id))
      throw new ApiError("FORBIDDEN", "You can't comment on this post");
    const b = req.body as z.infer<typeof createCommentRequest>;
    let parentAuthor: string | null = null;
    if (b.parentId) {
      const p = (
        await this.pool.query<{ user_id: string; parent_id: string | null }>(
          "SELECT user_id, parent_id FROM comments WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL AND hidden_at IS NULL",
          [b.parentId, id],
        )
      ).rows[0];
      if (!p) throw new ApiError("NOT_FOUND", "Unknown comment");
      if (p.parent_id)
        throw new ApiError("VALIDATION_FAILED", "Replies can only go one level deep");
      if (await this.social.blockedEitherWay(me, p.user_id))
        throw new ApiError("FORBIDDEN", "You can't reply to this comment");
      parentAuthor = p.user_id;
    }
    const cid = newId();
    await this.pool.query(
      "INSERT INTO comments (id, post_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4, $5)",
      [cid, id, me, b.parentId ?? null, b.body],
    );
    await this.social.notify({
      userId: post.user_id,
      kind: "comment",
      actorId: me,
      postId: id,
      commentId: cid,
    });
    if (parentAuthor && parentAuthor !== post.user_id)
      await this.social.notify({
        userId: parentAuthor,
        kind: "reply",
        actorId: me,
        postId: id,
        commentId: cid,
      });
    await this.social.rescore(me);
    return { id: cid };
  }

  @Route({
    method: "DELETE",
    path: "/comments/:id",
    summary: "Delete your comment (soft)",
    tags: ["posts"],
    auth: "user",
  })
  async removeComment(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "comment");
    const r = await this.pool.query(
      "UPDATE comments SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [id, uid(req)],
    );
    if (!r.rowCount) throw new ApiError("NOT_FOUND", "Unknown comment");
    return { deleted: true };
  }

  // ---- Reactions ------------------------------------------------------------------------------

  @Route({
    method: "POST",
    path: "/posts/:id/reactions",
    summary: "Mark helpful / not helpful (mutually exclusive; never on your own post)",
    tags: ["posts"],
    auth: "user",
    body: reactionRequest,
  })
  async react(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    const me = uid(req);
    const { kind } = req.body as z.infer<typeof reactionRequest>;
    const post = await this.social.visiblePost(me, id);
    if (post.user_id === me) throw new ApiError("FORBIDDEN", "You can't react to your own post");
    if (await this.social.blockedEitherWay(me, post.user_id))
      throw new ApiError("FORBIDDEN", "You can't react to this post");
    await this.limiter.consume(LIMITS.helpfulPerUser, me);
    const client = await this.pool.connect();
    let created: boolean;
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 AND kind IN ('helpful', 'not_helpful') AND kind <> $3",
        [id, me, kind],
      );
      const r = await client.query(
        "INSERT INTO reactions (post_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [id, me, kind],
      );
      created = (r.rowCount ?? 0) > 0;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    if (created && kind === "helpful")
      await this.social.notify({ userId: post.user_id, kind: "helpful", actorId: me, postId: id });
    await this.social.rescore(post.user_id);
    return { reaction: kind };
  }

  @Route({
    method: "DELETE",
    path: "/posts/:id/reactions/:kind",
    summary: "Remove your reaction",
    tags: ["posts"],
    auth: "user",
  })
  async unreact(@Req() req: FastifyRequest, @Param("id") id: string, @Param("kind") kind: string) {
    id404(id, "post");
    if (!reactionRequest.shape.kind.safeParse(kind).success)
      throw new ApiError("NOT_FOUND", "Unknown reaction");
    const me = uid(req);
    const post = await this.social.visiblePost(me, id);
    await this.pool.query(
      "DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 AND kind = $3",
      [id, me, kind],
    );
    await this.social.rescore(post.user_id);
    return { reaction: null };
  }

  @Route({
    method: "POST",
    path: "/comments/:id/reactions",
    summary: "Mark a comment or answer helpful / not helpful",
    tags: ["posts"],
    auth: "user",
    body: reactionRequest,
  })
  async reactComment(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "comment");
    const me = uid(req);
    const { kind } = req.body as z.infer<typeof reactionRequest>;
    const c = (
      await this.pool.query<{ user_id: string; post_id: string }>(
        "SELECT user_id, post_id FROM comments WHERE id = $1 AND deleted_at IS NULL AND hidden_at IS NULL",
        [id],
      )
    ).rows[0];
    if (!c) throw new ApiError("NOT_FOUND", "Unknown comment");
    await this.social.visiblePost(me, c.post_id);
    if (c.user_id === me) throw new ApiError("FORBIDDEN", "You can't react to your own comment");
    if (await this.social.blockedEitherWay(me, c.user_id))
      throw new ApiError("FORBIDDEN", "You can't react to this comment");
    await this.limiter.consume(LIMITS.helpfulPerUser, me);
    await this.pool.query(
      `INSERT INTO comment_reactions (comment_id, user_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT (comment_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`,
      [id, me, kind],
    );
    await this.social.rescore(c.user_id);
    return { reaction: kind };
  }

  // ---- Bookmarks, reports ---------------------------------------------------------------------

  @Route({
    method: "POST",
    path: "/posts/:id/bookmark",
    summary: "Bookmark",
    tags: ["posts"],
    auth: "user",
  })
  async bookmark(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    await this.social.visiblePost(uid(req), id);
    await this.pool.query(
      "INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [uid(req), id],
    );
    return { bookmarked: true };
  }

  @Route({
    method: "DELETE",
    path: "/posts/:id/bookmark",
    summary: "Remove bookmark",
    tags: ["posts"],
    auth: "user",
  })
  async unbookmark(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    await this.pool.query("DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2", [
      uid(req),
      id,
    ]);
    return { bookmarked: false };
  }

  @Route({
    method: "GET",
    path: "/bookmarks",
    summary: "Your bookmarked posts (still visible to you)",
    tags: ["posts"],
    auth: "user",
  })
  async bookmarks(@Req() req: FastifyRequest) {
    const me = uid(req);
    const rows = (
      await this.pool.query<PostRow>(
        `SELECT ${POST_COLUMNS} FROM bookmarks bm JOIN posts p ON p.id = bm.post_id
          WHERE bm.user_id = $1 AND ${VISIBLE_POST_SQL} ORDER BY bm.created_at DESC LIMIT 100`,
        [me],
      )
    ).rows;
    return { items: await this.social.views(me, rows) };
  }

  @Route({
    method: "POST",
    path: "/posts/:id/report",
    summary: "Report a post to moderators",
    tags: ["posts"],
    auth: "user",
    body: reportRequest,
    status: 201,
  })
  async report(@Req() req: FastifyRequest, @Param("id") id: string) {
    id404(id, "post");
    const me = uid(req);
    await this.social.visiblePost(me, id);
    const b = req.body as z.infer<typeof reportRequest>;
    await this.pool.query(
      `INSERT INTO moderation_reports (id, reporter_id, target_type, target_id, reason, note)
       VALUES ($1, $2, 'post', $3, $4, $5) ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [newId(), me, id, b.reason, b.note ?? null],
    );
    await this.audit.write({
      actorType: "user",
      actorUserId: me,
      action: "post.reported",
      outcome: "success",
      targetType: "post",
      targetId: id,
      requestId: req.suiem.requestId,
      details: { reason: b.reason },
    });
    return { reported: true };
  }

  // ---- Feed -----------------------------------------------------------------------------------

  private async trending(asOf: Date) {
    const r = await this.pool.query<{
      id: string;
      canonical_id: string;
      name: string;
      activity: string;
    }>(
      `SELECT e.id, e.canonical_id, e.name, count(*) AS activity FROM (
         SELECT entity_id FROM research_briefs WHERE created_at > $1::timestamptz - interval '24 hours' AND created_at <= $1
         UNION ALL SELECT t.entity_id FROM thesis_versions v JOIN theses t ON t.id = v.thesis_id
                    WHERE v.created_at > $1::timestamptz - interval '24 hours' AND v.created_at <= $1
         UNION ALL SELECT entity_id FROM posts WHERE entity_id IS NOT NULL AND deleted_at IS NULL
                    AND created_at > $1::timestamptz - interval '24 hours' AND created_at <= $1
       ) a JOIN entities e ON e.id = a.entity_id GROUP BY e.id, e.canonical_id, e.name
       ORDER BY activity DESC, e.name LIMIT 5`,
      [asOf],
    );
    return r.rows.map((x) => ({
      uuid: x.id,
      id: x.canonical_id,
      name: x.name,
      activity: Number(x.activity),
    }));
  }

  @Route({
    method: "GET",
    path: "/feed",
    summary:
      "Following or Discover feed (cursor pagination; muted, blocked, deleted and non-visible posts excluded)",
    tags: ["feed"],
    auth: "user",
    query: feedQuery,
    response: feedResponse,
  })
  async feed(@Req() req: FastifyRequest) {
    const me = uid(req);
    const q = req.query as z.infer<typeof feedQuery>;
    const entity = q.entityId ? await this.entityUuid(q.entityId) : null;

    if (q.tab === "following") {
      const c = decodeCursor<{ t: string; id: string }>(q.cursor);
      const rows = (
        await this.pool.query<PostRow>(
          `SELECT ${POST_COLUMNS} FROM posts p
            WHERE ${VISIBLE_POST_SQL} AND ${NOT_MUTED_SQL}
              AND (p.user_id = $1::uuid OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = p.user_id))
              AND ($2::uuid IS NULL OR p.entity_id = $2)
              AND ($3::timestamptz IS NULL OR (p.created_at, p.id) < ($3::timestamptz, $4::uuid))
            ORDER BY p.created_at DESC, p.id DESC LIMIT ${PAGE_SIZE + 1}`,
          [me, entity, c?.t ?? null, c?.id ?? null],
        )
      ).rows;
      const page = rows.slice(0, PAGE_SIZE);
      const last = page[page.length - 1];
      return {
        items: await this.social.views(me, page),
        nextCursor:
          rows.length > PAGE_SIZE && last
            ? encodeCursor({ t: last.created_at.toISOString(), id: last.id })
            : null,
        trending: (await this.trending(this.clock.now())).map(({ uuid: _u, ...t }) => t),
      };
    }

    // Discover: rank a bounded candidate set at a fixed asOf, then slice by offset.
    const c = decodeCursor<{ asOf: string; o: number }>(q.cursor);
    const asOf = c?.asOf ? new Date(c.asOf) : this.clock.now();
    if (Number.isNaN(asOf.getTime())) throw new ApiError("VALIDATION_FAILED", "Invalid cursor");
    const offset = Math.max(0, Math.floor(Number(c?.o ?? 0)) || 0);
    const candidates = (
      await this.pool.query<PostRow & { is_demo: boolean }>(
        `SELECT ${POST_COLUMNS}, u.is_demo FROM posts p JOIN users u ON u.id = p.user_id
          WHERE ${VISIBLE_POST_SQL} AND ${NOT_MUTED_SQL}
            AND p.created_at <= $2 AND p.created_at > $2::timestamptz - interval '14 days'
            AND ($3::uuid IS NULL OR p.entity_id = $3)
          ORDER BY p.created_at DESC LIMIT 500`,
        [me, asOf, entity],
      )
    ).rows;
    const ids = candidates.map((p) => p.id);
    const votes = ids.length
      ? (
          await this.pool.query<{
            post_id: string;
            user_id: string;
            kind: "helpful" | "not_helpful";
            created_at: Date;
          }>(
            "SELECT post_id, user_id, kind, created_at FROM reactions WHERE post_id = ANY($1) AND kind IN ('helpful', 'not_helpful') AND created_at <= $2",
            [ids, asOf],
          )
        ).rows
      : [];
    const raterIds = [...new Set(votes.map((v) => v.user_id))];
    const raters = raterIds.length
      ? (
          await this.pool.query<{
            id: string;
            created_at: Date;
            is_demo: boolean;
            research_since: Date | null;
          }>(
            `SELECT u.id, u.created_at, u.is_demo,
                    (SELECT min(t.published_at) FROM theses t WHERE t.user_id = u.id AND t.status <> 'draft' AND t.visibility <> 'private') AS research_since
               FROM users u WHERE u.id = ANY($1)`,
            [raterIds],
          )
        ).rows
      : [];
    const trending = await this.trending(asOf);
    const order = rank({
      candidates: candidates.map((p) => ({
        id: p.id,
        authorId: p.user_id,
        authorIsDemo: p.is_demo,
        entityId: p.entity_id,
        createdAt: p.created_at,
      })),
      votes: votes.map((v) => ({
        postId: v.post_id,
        targetId: v.post_id,
        target: "research" as const,
        raterId: v.user_id,
        kind: v.kind,
        createdAt: v.created_at.toISOString(),
      })),
      raters: raters.map((r) => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        isDemo: r.is_demo,
        researchSince: r.research_since?.toISOString() ?? null,
      })),
      trending: new Map(trending.map((t) => [t.uuid, t.activity])),
      asOf,
    });
    const byId = new Map(candidates.map((p) => [p.id, p]));
    const pageIds = order.slice(offset, offset + PAGE_SIZE);
    return {
      items: await this.social.views(
        me,
        pageIds.map((i) => byId.get(i)!),
      ),
      nextCursor:
        offset + PAGE_SIZE < order.length
          ? encodeCursor({ asOf: asOf.toISOString(), o: offset + PAGE_SIZE })
          : null,
      trending: trending.map(({ uuid: _u, ...t }) => t),
    };
  }

  // ---- Notifications --------------------------------------------------------------------------

  @Route({
    method: "GET",
    path: "/notifications",
    summary: "In-app notifications with the unread count",
    tags: ["notifications"],
    auth: "user",
  })
  async notifications(@Req() req: FastifyRequest) {
    const me = uid(req);
    const rows = (
      await this.pool.query<{
        id: string;
        kind: string;
        post_id: string | null;
        comment_id: string | null;
        thesis_id: string | null;
        details: Record<string, unknown>;
        read_at: Date | null;
        created_at: Date;
        actor_handle: string | null;
        actor_name: string | null;
      }>(
        `SELECT n.id, n.kind, n.post_id, n.comment_id, n.thesis_id, n.details, n.read_at, n.created_at,
                a.handle AS actor_handle, a.display_name AS actor_name
           FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
          WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 100`,
        [me],
      )
    ).rows;
    const unread = (
      await this.pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL",
        [me],
      )
    ).rows[0]!.n;
    return {
      unread: Number(unread),
      items: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        postId: n.post_id,
        commentId: n.comment_id,
        thesisId: n.thesis_id,
        details: n.details,
        actor: n.actor_handle ? { handle: n.actor_handle, displayName: n.actor_name } : null,
        read: n.read_at !== null,
        createdAt: n.created_at.toISOString(),
      })),
    };
  }

  @Route({
    method: "POST",
    path: "/notifications/read",
    summary: "Mark all notifications read",
    tags: ["notifications"],
    auth: "user",
  })
  async markRead(@Req() req: FastifyRequest) {
    await this.pool.query(
      "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
      [uid(req)],
    );
    return { unread: 0 };
  }
}
