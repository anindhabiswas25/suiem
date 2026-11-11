import { Inject, Injectable } from "@nestjs/common";
import type { DbHandle } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import type { PostKind, PostView, Visibility } from "@suiem/shared/social";
import { ApiError } from "../http/errors";
import type { AppLogger } from "../observability/logger";
import { DB, LOGGER } from "../tokens";
import { REPUTATION, type ReputationRuntime } from "./reputation.runtime";

export interface Relation {
  self: boolean;
  following: boolean;
  followedBy: boolean;
  /** The owner blocked the viewer. */
  blockedByOwner: boolean;
  /** The viewer blocked the owner. */
  blocking: boolean;
  muting: boolean;
}

export const NO_RELATION: Relation = {
  self: false,
  following: false,
  followedBy: false,
  blockedByOwner: false,
  blocking: false,
  muting: false,
};

/** Can a viewer with this relation see a field set to `v`? (PRD §9.4) */
export function allowed(v: Visibility, rel: Relation): boolean {
  if (rel.self) return true;
  if (rel.blockedByOwner || rel.blocking) return false;
  return v === "public" || (v === "followers" && rel.following);
}

/**
 * Server-side post visibility for viewer `$1` (may be NULL for anonymous). Excludes deleted and
 * hidden posts, either-direction blocks, posts the viewer may not see by visibility, thesis
 * posts whose thesis is no longer visible, and portfolio snapshots the author's portfolio
 * setting no longer allows.
 */
export const VISIBLE_POST_SQL = `
  p.deleted_at IS NULL AND p.hidden_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = p.user_id AND b.blocked_id = $1::uuid)
                                         OR (b.blocker_id = $1::uuid AND b.blocked_id = p.user_id))
  AND (
    p.user_id = $1::uuid
    OR (
      (p.visibility = 'public' OR (p.visibility = 'followers' AND EXISTS (
        SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = p.user_id)))
      AND (p.kind <> 'thesis' OR EXISTS (
        SELECT 1 FROM theses t WHERE t.id = p.thesis_id AND (t.visibility = 'public' OR (t.visibility = 'followers'
          AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = p.user_id)))))
      AND (p.kind <> 'portfolio_snapshot' OR EXISTS (
        SELECT 1 FROM profiles pr WHERE pr.user_id = p.user_id AND (pr.portfolio_visibility = 'public'
          OR (pr.portfolio_visibility = 'followers'
              AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.followee_id = p.user_id)))))
    )
  )`;

export const NOT_MUTED_SQL = `NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = $1::uuid AND m.muted_id = p.user_id)`;

export interface PostRow {
  id: string;
  user_id: string;
  kind: PostKind;
  body: string;
  entity_id: string | null;
  thesis_id: string | null;
  brief_id: string | null;
  visibility: Visibility;
  ai_assisted: boolean;
  sponsored: boolean;
  sourced: boolean;
  attachment: Record<string, unknown> | null;
  created_at: Date;
}

export const POST_COLUMNS = `p.id, p.user_id, p.kind, p.body, p.entity_id, p.thesis_id, p.brief_id, p.visibility,
  p.ai_assisted, p.sponsored, p.sourced, p.attachment, p.created_at`;

@Injectable()
export class SocialService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REPUTATION) private readonly reputation: ReputationRuntime,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  get pool() {
    return this.db.pool;
  }

  async userByHandle(handle: string) {
    const r = await this.pool.query<{
      id: string;
      handle: string;
      display_name: string | null;
      is_demo: boolean;
      created_at: Date;
      status: string;
    }>(
      "SELECT id, handle, display_name, is_demo, created_at, status FROM users WHERE handle = $1 AND status = 'active'",
      [handle],
    );
    return r.rows[0] ?? null;
  }

  async userById(id: string) {
    const r = await this.pool.query<{ id: string; handle: string; status: string }>(
      "SELECT id, handle, status FROM users WHERE id = $1 AND status = 'active'",
      [id],
    );
    return r.rows[0] ?? null;
  }

  async relation(viewerId: string | null, ownerId: string): Promise<Relation> {
    if (!viewerId) return NO_RELATION;
    if (viewerId === ownerId) return { ...NO_RELATION, self: true };
    const r = await this.pool.query<Omit<Relation, "self">>(
      `SELECT
         EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS following,
         EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS "followedBy",
         EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $1) AS "blockedByOwner",
         EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2) AS blocking,
         EXISTS (SELECT 1 FROM mutes WHERE muter_id = $1 AND muted_id = $2) AS muting`,
      [viewerId, ownerId],
    );
    return { self: false, ...r.rows[0]! };
  }

  /** Either-direction block between two users. */
  async blockedEitherWay(a: string, b: string): Promise<boolean> {
    const r = await this.pool.query(
      "SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)",
      [a, b],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** In-app notification. Never to yourself, never from someone the recipient blocked. */
  async notify(n: {
    userId: string;
    kind: "new_follower" | "comment" | "reply" | "helpful" | "report_outcome" | "appeal_outcome";
    actorId?: string | null;
    postId?: string | null;
    commentId?: string | null;
    details?: Record<string, unknown>;
  }): Promise<void> {
    if (n.actorId && n.actorId === n.userId) return;
    if (n.actorId && (await this.blockedEitherWay(n.userId, n.actorId))) return;
    await this.pool.query(
      `INSERT INTO notifications (id, user_id, kind, actor_id, post_id, comment_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId(),
        n.userId,
        n.kind,
        n.actorId ?? null,
        n.postId ?? null,
        n.commentId ?? null,
        JSON.stringify(n.details ?? {}),
      ],
    );
  }

  /** Re-scores a user after a change (snapshots are written only if the result changed). */
  async rescore(userId: string): Promise<void> {
    try {
      await this.reputation.recompute(userId);
    } catch (e) {
      this.logger.warn(
        { component: "reputation", error: (e as Error).message },
        "rescore failed (the hourly job will retry)",
      );
    }
  }

  /** A single post the viewer may see, or 404. */
  async visiblePost(viewerId: string | null, id: string): Promise<PostRow> {
    const r = await this.pool.query<PostRow>(
      `SELECT ${POST_COLUMNS} FROM posts p WHERE p.id = $2 AND ${VISIBLE_POST_SQL}`,
      [viewerId, id],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError("NOT_FOUND", "Unknown post");
    return row;
  }

  /** Builds post views in one batch (author, entity, counts, the viewer's own state). */
  async views(viewerId: string | null, rows: PostRow[]): Promise<PostView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [authors, entities, counts, mine, marks] = await Promise.all([
      this.pool.query<{
        id: string;
        handle: string;
        display_name: string | null;
        is_demo: boolean;
      }>("SELECT id, handle, display_name, is_demo FROM users WHERE id = ANY($1)", [
        [...new Set(rows.map((r) => r.user_id))],
      ]),
      this.pool.query<{ id: string; canonical_id: string; name: string }>(
        "SELECT id, canonical_id, name FROM entities WHERE id = ANY($1)",
        [[...new Set(rows.map((r) => r.entity_id).filter(Boolean))]],
      ),
      this.pool.query<{ post_id: string; helpful: string; not_helpful: string; comments: string }>(
        `SELECT p.id AS post_id,
                (SELECT count(*) FROM reactions r WHERE r.post_id = p.id AND r.kind = 'helpful') AS helpful,
                (SELECT count(*) FROM reactions r WHERE r.post_id = p.id AND r.kind = 'not_helpful') AS not_helpful,
                (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND c.hidden_at IS NULL) AS comments
           FROM posts p WHERE p.id = ANY($1)`,
        [ids],
      ),
      viewerId
        ? this.pool.query<{ post_id: string; kind: "helpful" | "not_helpful" }>(
            "SELECT post_id, kind FROM reactions WHERE user_id = $1 AND post_id = ANY($2) AND kind IN ('helpful', 'not_helpful')",
            [viewerId, ids],
          )
        : { rows: [] },
      viewerId
        ? this.pool.query<{ post_id: string }>(
            "SELECT post_id FROM bookmarks WHERE user_id = $1 AND post_id = ANY($2)",
            [viewerId, ids],
          )
        : { rows: [] },
    ]);
    const author = new Map(authors.rows.map((a) => [a.id, a]));
    const entity = new Map(entities.rows.map((e) => [e.id, e]));
    const count = new Map(counts.rows.map((c) => [c.post_id, c]));
    const reaction = new Map(mine.rows.map((m) => [m.post_id, m.kind]));
    const marked = new Set(marks.rows.map((m) => m.post_id));
    return rows.map((r) => {
      const a = author.get(r.user_id)!;
      const e = r.entity_id ? entity.get(r.entity_id) : undefined;
      const c = count.get(r.id);
      return {
        id: r.id,
        kind: r.kind,
        body: r.body,
        author: { id: a.id, handle: a.handle, displayName: a.display_name, isDemo: a.is_demo },
        visibility: r.visibility,
        entity: e ? { id: e.canonical_id, name: e.name } : null,
        attachment: r.attachment,
        labels: {
          sourced: r.sourced,
          aiAssisted: r.ai_assisted,
          sponsored: r.sponsored,
          simulatedTestnet: r.kind === "portfolio_snapshot",
        },
        counts: {
          helpful: Number(c?.helpful ?? 0),
          notHelpful: Number(c?.not_helpful ?? 0),
          comments: Number(c?.comments ?? 0),
        },
        viewer: {
          reaction: reaction.get(r.id) ?? null,
          bookmarked: marked.has(r.id),
          isAuthor: viewerId === r.user_id,
        },
        createdAt: r.created_at.toISOString(),
      };
    });
  }
}
