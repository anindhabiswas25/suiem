import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import { createHmac, randomBytes } from "node:crypto";
import { SESSION_COOKIE, type SessionInfo } from "../http/context";
import { CLOCK, type Clock, DB, ENV } from "../tokens";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type Amr = SessionInfo["amr"][number];

/**
 * Opaque random session tokens; only an HMAC is stored, so a DB leak cannot be replayed as
 * cookies. A new session (rotation) is issued on every login.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  hash(token: string): Buffer {
    return createHmac("sha256", this.env.SESSION_SECRET).update(`session:${token}`).digest();
  }

  async create(
    userId: string,
    amr: Amr[],
    rotateFrom?: string,
  ): Promise<{ token: string; session: SessionInfo }> {
    const token = randomBytes(32).toString("base64url");
    const now = this.clock.now();
    const id = newId();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const methods = [...new Set(amr)];
    await this.db.db.transaction(async (tx) => {
      if (rotateFrom)
        await tx
          .update(schema.sessions)
          .set({ revokedAt: now })
          .where(eq(schema.sessions.id, rotateFrom));
      await tx.insert(schema.sessions).values({
        id,
        userId,
        tokenHash: this.hash(token),
        amr: methods,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        rotatedFrom: rotateFrom ?? null,
      });
    });
    return { token, session: { sessionId: id, userId, amr: methods, expiresAt } };
  }

  async resolve(token: string | undefined): Promise<SessionInfo | undefined> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const now = this.clock.now();
    const rows = await this.db.db
      .select({
        id: schema.sessions.id,
        userId: schema.sessions.userId,
        amr: schema.sessions.amr,
        expiresAt: schema.sessions.expiresAt,
        status: schema.users.status,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .where(
        and(
          eq(schema.sessions.tokenHash, this.hash(token)),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || row.status !== "active") return undefined;
    return {
      sessionId: row.id,
      userId: row.userId,
      amr: row.amr as Amr[],
      expiresAt: row.expiresAt,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.db
      .update(schema.sessions)
      .set({ revokedAt: this.clock.now() })
      .where(eq(schema.sessions.id, sessionId));
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
    void reply.clearCookie(SESSION_COOKIE, {
      path: "/",
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax",
    });
  }
}
