import { Controller, Inject, Param, Req } from "@nestjs/common";
import type { DbHandle } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { amount, divRound, formatAmount } from "@suiem/shared/money";
import {
  handleParam,
  patchProfileRequest,
  type PatchProfileRequest,
  type Visibility,
} from "@suiem/shared/social";
import { uuidParam } from "@suiem/shared/schemas";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service";
import { ACHIEVEMENTS, type AchievementsProvider } from "./achievements";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { DB } from "../tokens";
import { ReputationView } from "./reputation.view";
import {
  allowed,
  POST_COLUMNS,
  type PostRow,
  SocialService,
  VISIBLE_POST_SQL,
} from "./social.service";

const BOOK_LABEL = { simulated: "Simulated", testnet: "Testnet · no value" } as const;
export const PORTFOLIO_LABEL = "Simulated / testnet performance, not live verified";

const viewer = (req: FastifyRequest) => req.suiem.session?.userId ?? null;

interface ProfileRow {
  bio: string | null;
  portfolio_visibility: Visibility;
  positions_visibility: Visibility;
  transactions_visibility: Visibility;
  theses_visibility: Visibility;
  research_activity_visibility: Visibility;
  followers_visibility: Visibility;
  wallet_visibility: Visibility;
  appear_in_leaderboards: boolean;
}

/**
 * Allocation snapshot (read-only, PRD §8.6): percentages of cost basis per book, with the book
 * label and a timestamp. No quantities, no amounts, no addresses. Books are never summed.
 */
export async function allocationSnapshot(db: DbHandle, userId: string, withHeldSince: boolean) {
  const rows = (
    await db.pool.query<{
      book: "simulated" | "testnet";
      symbol: string;
      display_name: string;
      entity_id: string | null;
      cost_basis: string;
      held_since: Date | null;
    }>(
      `SELECT p.book::text AS book, i.symbol, i.display_name, e.canonical_id AS entity_id, p.cost_basis::text,
              (SELECT min(f.filled_at) FROM fills f JOIN orders o ON o.id = f.order_id
                WHERE o.user_id = p.user_id AND o.instrument_id = p.instrument_id AND o.book::text = p.book::text) AS held_since
         FROM positions p JOIN instruments i ON i.id = p.instrument_id LEFT JOIN entities e ON e.id = i.entity_id
        WHERE p.user_id = $1 AND p.quantity > 0 AND p.cost_basis > 0 AND p.book::text IN ('simulated', 'testnet')
        ORDER BY p.book, i.symbol`,
      [userId],
    )
  ).rows;
  const books = (["simulated", "testnet"] as const)
    .map((book) => {
      const ps = rows.filter((r) => r.book === book);
      const total = ps.reduce((a, r) => a + BigInt(r.cost_basis), 0n);
      return {
        book,
        label: BOOK_LABEL[book],
        allocations: ps.map((r) => ({
          symbol: r.symbol,
          name: r.display_name,
          entityId: r.entity_id,
          percent: formatAmount(
            amount(divRound(BigInt(r.cost_basis) * 10_000n, total, "halfEven"), 2),
            { trimZeros: false },
          ),
          ...(withHeldSince ? { heldSince: r.held_since?.toISOString() ?? null } : {}),
        })),
      };
    })
    .filter((b) => b.allocations.length > 0);
  return {
    asOf: new Date().toISOString(),
    basis: "Share of cost basis within each book",
    label: PORTFOLIO_LABEL,
    books,
  };
}

/** Profiles, privacy settings, read-only portfolio snapshots and the social graph (PRD §9.4). */
@Controller()
export class ProfilesController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(ReputationView) private readonly rep: ReputationView,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ACHIEVEMENTS) private readonly achievements: AchievementsProvider,
  ) {}

  private async profileRow(userId: string): Promise<ProfileRow> {
    const r = await this.db.pool.query<ProfileRow>("SELECT * FROM profiles WHERE user_id = $1", [
      userId,
    ]);
    if (!r.rows[0]) throw new ApiError("NOT_FOUND", "Unknown profile");
    return r.rows[0];
  }

  private async owner(handle: string, viewerId: string | null) {
    if (!handleParam.safeParse(handle).success) throw new ApiError("NOT_FOUND", "Unknown profile");
    const u = await this.social.userByHandle(handle);
    if (!u) throw new ApiError("NOT_FOUND", "Unknown profile");
    const rel = await this.social.relation(viewerId, u.id);
    // Someone who blocked you is invisible to you.
    if (rel.blockedByOwner) throw new ApiError("NOT_FOUND", "Unknown profile");
    return { u, rel, p: await this.profileRow(u.id) };
  }

  private settings(p: ProfileRow) {
    return {
      portfolioVisibility: p.portfolio_visibility,
      positionsVisibility: p.positions_visibility,
      transactionsVisibility: p.transactions_visibility,
      thesesVisibility: p.theses_visibility,
      researchActivityVisibility: p.research_activity_visibility,
      followersVisibility: p.followers_visibility,
      walletVisibility: p.wallet_visibility,
      appearInLeaderboards: p.appear_in_leaderboards,
    };
  }

  @Route({
    method: "GET",
    path: "/me/profile",
    summary: "Your profile and per-field privacy settings",
    tags: ["profiles"],
    auth: "user",
  })
  async myProfile(@Req() req: FastifyRequest) {
    const id = req.suiem.session!.userId;
    const u = (
      await this.db.pool.query<{
        handle: string;
        display_name: string | null;
        handle_changed_at: Date | null;
        role: string;
        is_demo: boolean;
      }>("SELECT handle, display_name, handle_changed_at, role, is_demo FROM users WHERE id = $1", [
        id,
      ])
    ).rows[0]!;
    const p = await this.profileRow(id);
    return {
      handle: u.handle,
      displayName: u.display_name,
      bio: p.bio,
      handleChangeAvailable: u.handle_changed_at === null,
      isModerator: u.role === "moderator",
      isDemo: u.is_demo,
      privacy: this.settings(p),
    };
  }

  @Route({
    method: "PATCH",
    path: "/me/profile",
    summary: "Update display name, bio, handle (once) and privacy settings",
    tags: ["profiles"],
    auth: "user",
    body: patchProfileRequest,
  })
  async patchProfile(@Req() req: FastifyRequest) {
    const id = req.suiem.session!.userId;
    const b = req.body as PatchProfileRequest;
    const current = await this.profileRow(id);
    if (
      b.walletVisibility &&
      b.walletVisibility !== "private" &&
      current.wallet_visibility === "private" &&
      !b.acknowledgeOnchainPublicity
    )
      throw new ApiError(
        "VALIDATION_FAILED",
        "Showing a wallet address links your profile to all of its onchain history. Acknowledge this to continue.",
      );
    if (b.handle !== undefined) {
      const u = (
        await this.db.pool.query<{ handle: string; handle_changed_at: Date | null }>(
          "SELECT handle, handle_changed_at FROM users WHERE id = $1",
          [id],
        )
      ).rows[0]!;
      if (b.handle !== u.handle) {
        if (u.handle_changed_at)
          throw new ApiError("CONFLICT", "Your handle can only be changed once");
        try {
          await this.db.pool.query(
            "UPDATE users SET handle = $2, handle_changed_at = now() WHERE id = $1",
            [id, b.handle],
          );
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new ApiError("CONFLICT", "That handle is taken");
          throw e;
        }
      }
    }
    if (b.displayName !== undefined)
      await this.db.pool.query("UPDATE users SET display_name = $2 WHERE id = $1", [
        id,
        b.displayName,
      ]);
    const cols: [string, unknown][] = [
      ["bio", b.bio],
      ["portfolio_visibility", b.portfolioVisibility],
      ["positions_visibility", b.positionsVisibility],
      ["transactions_visibility", b.transactionsVisibility],
      ["theses_visibility", b.thesesVisibility],
      ["research_activity_visibility", b.researchActivityVisibility],
      ["followers_visibility", b.followersVisibility],
      ["wallet_visibility", b.walletVisibility],
      ["appear_in_leaderboards", b.appearInLeaderboards],
    ];
    const set = cols.filter(([, v]) => v !== undefined);
    if (set.length)
      await this.db.pool.query(
        `UPDATE profiles SET ${set.map(([c], i) => `${c} = $${i + 2}`).join(", ")} WHERE user_id = $1`,
        [id, ...set.map(([, v]) => v)],
      );
    await this.audit.write({
      actorType: "user",
      actorUserId: id,
      action: "profile.updated",
      outcome: "success",
      requestId: req.suiem.requestId,
      details: { fields: [...set.map(([c]) => c), ...(b.handle ? ["handle"] : [])] },
    });
    return this.myProfile(req);
  }

  @Route({
    method: "GET",
    path: "/profiles/:handle",
    summary: "Public profile (each field per its privacy setting)",
    tags: ["profiles"],
    auth: "optional",
  })
  async profile(@Req() req: FastifyRequest, @Param("handle") handle: string) {
    const v = viewer(req);
    const { u, rel, p } = await this.owner(handle, v);
    const badges = ["Season 1"];
    const base = {
      id: u.id,
      handle: u.handle,
      displayName: u.display_name,
      joinedAt: u.created_at.toISOString(),
      isDemo: u.is_demo,
      badges,
      isMe: rel.self,
      relation: {
        following: rel.following,
        followedBy: rel.followedBy,
        muting: rel.muting,
        blocking: rel.blocking,
      },
    };
    if (rel.blocking) return { ...base, bio: null, blocked: true };
    const followers = allowed(p.followers_visibility, rel)
      ? (
          await this.db.pool.query<{ followers: string; following: string }>(
            `SELECT (SELECT count(*) FROM follows WHERE followee_id = $1) AS followers,
                    (SELECT count(*) FROM follows WHERE follower_id = $1) AS following`,
            [u.id],
          )
        ).rows.map((r) => ({ followers: Number(r.followers), following: Number(r.following) }))[0]!
      : null;
    const wallets = allowed(p.wallet_visibility, rel)
      ? (
          await this.db.pool.query<{ address: Buffer; chain_id: number }>(
            "SELECT address, chain_id FROM wallet_accounts WHERE user_id = $1 AND unlinked_at IS NULL",
            [u.id],
          )
        ).rows.map((w) => ({ address: `0x${w.address.toString("hex")}`, chainId: w.chain_id }))
      : null;
    const theses = allowed(p.theses_visibility, rel)
      ? (
          await this.db.pool.query<{
            id: string;
            title: string;
            direction: string;
            horizon_days: number;
            entity: string;
            entity_name: string;
            published_at: Date | null;
            status: string;
          }>(
            `SELECT t.id, v.title, v.direction, v.horizon_days, e.canonical_id AS entity, e.name AS entity_name,
                    t.published_at, t.status
               FROM theses t JOIN thesis_versions v ON v.thesis_id = t.id AND v.version = t.current_version
               JOIN entities e ON e.id = t.entity_id
              WHERE t.user_id = $1 AND t.status <> 'draft'
                AND (t.user_id = $2::uuid OR t.visibility = 'public' OR (t.visibility = 'followers' AND $3::boolean))
              ORDER BY t.published_at DESC NULLS LAST LIMIT 50`,
            [u.id, v, rel.following],
          )
        ).rows.map((t) => ({
          id: t.id,
          title: t.title,
          direction: t.direction,
          horizonDays: t.horizon_days,
          entityId: t.entity,
          entityName: t.entity_name,
          publishedAt: t.published_at?.toISOString() ?? null,
          status: t.status,
        }))
      : null;
    // The score card is shown to others only when the user opted in to leaderboards.
    const reputation = rel.self || p.appear_in_leaderboards ? await this.rep.forUser(u.id) : null;
    return {
      ...base,
      // Winner badges for finalized elections. An achievement, never a reputation input.
      achievements: await this.achievements.forUser(u.id),
      bio: p.bio,
      followers,
      wallets,
      theses,
      reputation,
      portfolioVisible: allowed(p.portfolio_visibility, rel),
      researchActivityVisible: allowed(p.research_activity_visibility, rel),
      ...(rel.self ? { privacy: this.settings(p) } : {}),
    };
  }

  @Route({
    method: "GET",
    path: "/profiles/:handle/research",
    summary: "Published research posts (per post visibility) and research activity (if allowed)",
    tags: ["profiles"],
    auth: "optional",
  })
  async research(@Req() req: FastifyRequest, @Param("handle") handle: string) {
    const v = viewer(req);
    const { u, rel, p } = await this.owner(handle, v);
    const rows = rel.blocking
      ? []
      : (
          await this.db.pool.query<PostRow>(
            `SELECT ${POST_COLUMNS} FROM posts p WHERE p.user_id = $2 AND ${VISIBLE_POST_SQL}
              ORDER BY p.created_at DESC, p.id DESC LIMIT 50`,
            [v, u.id],
          )
        ).rows;
    const activity = allowed(p.research_activity_visibility, rel)
      ? (
          await this.db.pool.query<{ entity: string; name: string; last: Date }>(
            `SELECT e.canonical_id AS entity, e.name, max(b.created_at) AS last
               FROM research_briefs b JOIN entities e ON e.id = b.entity_id
              WHERE b.user_id = $1 GROUP BY e.canonical_id, e.name ORDER BY last DESC LIMIT 20`,
            [u.id],
          )
        ).rows.map((r) => ({
          entityId: r.entity,
          name: r.name,
          lastResearchedAt: r.last.toISOString(),
        }))
      : null;
    return { posts: await this.social.views(v, rows), activity };
  }

  @Route({
    method: "GET",
    path: "/profiles/:handle/portfolio",
    summary: "Read-only allocation snapshot (percentages only), if the owner allows it",
    tags: ["profiles"],
    auth: "optional",
  })
  async portfolio(@Req() req: FastifyRequest, @Param("handle") handle: string) {
    const { u, rel, p } = await this.owner(handle, viewer(req));
    if (!allowed(p.portfolio_visibility, rel))
      throw new ApiError("FORBIDDEN", "This portfolio is private");
    const snapshot = await allocationSnapshot(this.db, u.id, allowed(p.positions_visibility, rel));
    const transactions = allowed(p.transactions_visibility, rel)
      ? (
          await this.db.pool.query<{ side: string; symbol: string; book: string; filled_at: Date }>(
            `SELECT o.side, i.symbol, o.book::text AS book, f.filled_at
               FROM fills f JOIN orders o ON o.id = f.order_id JOIN instruments i ON i.id = o.instrument_id
              WHERE o.user_id = $1 ORDER BY f.filled_at DESC LIMIT 20`,
            [u.id],
          )
        ).rows.map((t) => ({
          side: t.side,
          symbol: t.symbol,
          book: t.book,
          bookLabel: BOOK_LABEL[t.book as "simulated" | "testnet"] ?? t.book,
          at: t.filled_at.toISOString(),
        }))
      : null;
    return { ...snapshot, positionsVisible: allowed(p.positions_visibility, rel), transactions };
  }

  @Route({
    method: "POST",
    path: "/profiles/:handle/portfolio/watchlist",
    summary:
      "Save portfolio: creates a watchlist from the snapshot's companies. Never an order (no copy trading)",
    tags: ["profiles"],
    auth: "user",
    status: 201,
  })
  async savePortfolio(@Req() req: FastifyRequest, @Param("handle") handle: string) {
    const me = req.suiem.session!.userId;
    const { u, rel, p } = await this.owner(handle, me);
    if (!allowed(p.portfolio_visibility, rel))
      throw new ApiError("FORBIDDEN", "This portfolio is private");
    const snap = await allocationSnapshot(this.db, u.id, false);
    const entityIds = [
      ...new Set(snap.books.flatMap((b) => b.allocations.map((a) => a.entityId)).filter(Boolean)),
    ] as string[];
    const base = `@${u.handle} portfolio ${new Date().toISOString().slice(0, 10)}`.slice(0, 50);
    const id = newId();
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      let name = base;
      for (
        let i = 2;
        (
          await client.query("SELECT 1 FROM watchlists WHERE user_id = $1 AND name = $2", [
            me,
            name,
          ])
        ).rowCount;
        i++
      )
        name = `${base} (${i})`;
      await client.query("INSERT INTO watchlists (id, user_id, name) VALUES ($1, $2, $3)", [
        id,
        me,
        name,
      ]);
      for (const e of entityIds)
        await client.query(
          `INSERT INTO watchlist_items (id, watchlist_id, entity_id, note)
           SELECT $1, $2, id, $4 FROM entities WHERE canonical_id = $3`,
          [newId(), id, e, `From @${u.handle}'s portfolio snapshot (read-only)`],
        );
      await client.query("COMMIT");
      return { watchlistId: id, name, companies: entityIds.length };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- Graph: follow, mute, block ------------------------------------------------------------

  private async target(me: string, id: string) {
    if (!uuidParam.safeParse(id).success) throw new ApiError("NOT_FOUND", "Unknown user");
    if (id === me) throw new ApiError("VALIDATION_FAILED", "You can't do that to yourself");
    const u = await this.social.userById(id);
    if (!u) throw new ApiError("NOT_FOUND", "Unknown user");
    return u;
  }

  @Route({
    method: "POST",
    path: "/users/:id/follow",
    summary: "Follow a user",
    tags: ["graph"],
    auth: "user",
  })
  async follow(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = req.suiem.session!.userId;
    await this.target(me, id);
    // A blocked user can't follow the blocker (and you can't follow someone you blocked).
    if (await this.social.blockedEitherWay(me, id))
      throw new ApiError("FORBIDDEN", "You can't follow this user");
    const r = await this.db.pool.query(
      "INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [me, id],
    );
    if (r.rowCount) await this.social.notify({ userId: id, kind: "new_follower", actorId: me });
    return { following: true };
  }

  @Route({
    method: "DELETE",
    path: "/users/:id/follow",
    summary: "Unfollow",
    tags: ["graph"],
    auth: "user",
  })
  async unfollow(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = req.suiem.session!.userId;
    await this.target(me, id);
    await this.db.pool.query("DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2", [
      me,
      id,
    ]);
    return { following: false };
  }

  @Route({
    method: "POST",
    path: "/users/:id/mute",
    summary: "Mute: their posts leave your feed",
    tags: ["graph"],
    auth: "user",
  })
  async mute(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = req.suiem.session!.userId;
    await this.target(me, id);
    await this.db.pool.query(
      "INSERT INTO mutes (muter_id, muted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [me, id],
    );
    return { muting: true };
  }

  @Route({
    method: "DELETE",
    path: "/users/:id/mute",
    summary: "Unmute",
    tags: ["graph"],
    auth: "user",
  })
  async unmute(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = req.suiem.session!.userId;
    await this.target(me, id);
    await this.db.pool.query("DELETE FROM mutes WHERE muter_id = $1 AND muted_id = $2", [me, id]);
    return { muting: false };
  }

  @Route({
    method: "POST",
    path: "/users/:id/block",
    summary: "Block: they can't follow, comment on or react to you; follows both ways are removed",
    tags: ["graph"],
    auth: "user",
  })
  async block(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = req.suiem.session!.userId;
    await this.target(me, id);
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [me, id],
      );
      await client.query(
        "DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)",
        [me, id],
      );
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
      action: "user.blocked",
      outcome: "success",
      targetType: "user",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    return { blocking: true };
  }

  @Route({
    method: "DELETE",
    path: "/users/:id/block",
    summary: "Unblock",
    tags: ["graph"],
    auth: "user",
  })
  async unblock(@Req() req: FastifyRequest, @Param("id") id: string) {
    const me = req.suiem.session!.userId;
    await this.target(me, id);
    await this.db.pool.query("DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2", [
      me,
      id,
    ]);
    return { blocking: false };
  }
}
