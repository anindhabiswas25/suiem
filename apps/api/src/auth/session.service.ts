import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { createHmac, randomBytes } from "node:crypto";
import { SESSION_COOKIE, type SessionInfo } from "../http/context";
import type { SystemDb } from "../infra/system-db";
import { CLOCK, type Clock, ENV, SYSTEM_DB } from "../tokens";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Opaque, random session tokens. Only an HMAC of the token is stored, so a database leak
 * cannot be replayed as cookies. Sessions rotate on every login and privilege change (TM-01).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(SYSTEM_DB) private readonly db: SystemDb,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  hash(token: string): Buffer {
    return createHmac("sha256", this.env.SESSION_SECRET).update(`session:${token}`).digest();
  }

  async create(
    userId: string,
    amr: ("email_otp" | "passkey")[],
    options: { rotateFrom?: string; passkeyVerified?: boolean } = {},
  ): Promise<{ token: string; session: SessionInfo }> {
    const token = randomBytes(32).toString("base64url");
    const now = this.clock.now();
    const id = newId();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const passkeyVerifiedAt = options.passkeyVerified ? now : null;
    await this.db.db.transaction(async (tx) => {
      if (options.rotateFrom) {
        await tx.update(schema.userSessions).set({ revokedAt: now }).where(eq(schema.userSessions.id, options.rotateFrom));
      }
      await tx.insert(schema.userSessions).values({
        id,
        userId,
        tokenHash: this.hash(token),
        amr: [...new Set(amr)],
        passkeyVerifiedAt,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        rotatedFrom: options.rotateFrom ?? null,
      });
    });
    return { token, session: { sessionId: id, userId, amr: [...new Set(amr)], passkeyVerifiedAt, expiresAt } };
  }

  async resolve(token: string | undefined): Promise<SessionInfo | undefined> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const now = this.clock.now();
    const rows = await this.db.db
      .select({
        id: schema.userSessions.id,
        userId: schema.userSessions.userId,
        amr: schema.userSessions.amr,
        passkeyVerifiedAt: schema.userSessions.passkeyVerifiedAt,
        expiresAt: schema.userSessions.expiresAt,
        lastSeenAt: schema.userSessions.lastSeenAt,
        status: schema.users.status,
      })
      .from(schema.userSessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.userSessions.userId))
      .where(and(eq(schema.userSessions.tokenHash, this.hash(token)), isNull(schema.userSessions.revokedAt), gt(schema.userSessions.expiresAt, now)))
      .limit(1);
    const row = rows[0];
    if (!row || row.status !== "active") return undefined;
    if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await this.db.db.update(schema.userSessions).set({ lastSeenAt: now }).where(eq(schema.userSessions.id, row.id));
    }
    return {
      sessionId: row.id,
      userId: row.userId,
      amr: row.amr as SessionInfo["amr"],
      passkeyVerifiedAt: row.passkeyVerifiedAt,
      expiresAt: row.expiresAt,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.db.update(schema.userSessions).set({ revokedAt: this.clock.now() }).where(eq(schema.userSessions.id, sessionId));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.db
      .update(schema.userSessions)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(schema.userSessions.userId, userId), isNull(schema.userSessions.revokedAt)));
  }

  async activeCount(userId: string): Promise<number> {
    const r = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.userSessions)
      .where(and(eq(schema.userSessions.userId, userId), isNull(schema.userSessions.revokedAt), gt(schema.userSessions.expiresAt, this.clock.now())));
    return r[0]?.n ?? 0;
  }

  setCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }

  clearCookie(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: "lax" });
  }
}
