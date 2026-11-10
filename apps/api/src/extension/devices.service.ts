import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import type { DeviceInfo } from "../http/context";
import { ApiError } from "../http/errors";
import { CLOCK, type Clock, DB, ENV } from "../tokens";

export const PAIRING_TTL_MS = 5 * 60 * 1000;
/** Crockford-style alphabet without 0/O/1/I to avoid transcription errors. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_PREFIX = "sxt_";

/**
 * Extension pairing (Sprint 3 §4). A signed-in user gets a one-time code (5-minute TTL, single
 * use, stored hashed). The extension exchanges it for a device token (random, stored as HMAC,
 * revocable). Device tokens only work on extension-scoped routes (SecurityGuard).
 */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private hmac(kind: "pairing" | "device", value: string): Buffer {
    return createHmac("sha256", this.env.SESSION_SECRET).update(`${kind}:${value}`).digest();
  }

  async createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    await this.db.db
      .insert(schema.extensionPairingCodes)
      .values({ codeHash: this.hmac("pairing", code), userId, createdAt: now, expiresAt });
    return { code, expiresAt };
  }

  /** Atomically consumes the code (single use) and issues a device token. */
  async pair(
    code: string,
    label?: string,
  ): Promise<{ installationId: string; token: string; handle: string }> {
    const now = this.clock.now();
    const consumed = await this.db.db
      .update(schema.extensionPairingCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.extensionPairingCodes.codeHash, this.hmac("pairing", code)),
          isNull(schema.extensionPairingCodes.usedAt),
          gt(schema.extensionPairingCodes.expiresAt, now),
        ),
      )
      .returning({ userId: schema.extensionPairingCodes.userId });
    const userId = consumed[0]?.userId;
    if (!userId)
      throw new ApiError(
        "PAIRING_INVALID",
        "This pairing code is invalid, expired or already used. Create a new one in Suiem Settings.",
      );
    const user = (
      await this.db.db
        .select({ handle: schema.users.handle, status: schema.users.status })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    )[0];
    if (!user || user.status !== "active")
      throw new ApiError("PAIRING_INVALID", "This account cannot pair an extension.");
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const installationId = newId();
    await this.db.db.insert(schema.extensionInstallations).values({
      id: installationId,
      userId,
      tokenHash: this.hmac("device", token),
      label: label ?? "Chrome extension",
      createdAt: now,
    });
    return { installationId, token, handle: user.handle };
  }

  async resolve(token: string | undefined): Promise<DeviceInfo | undefined> {
    if (!token || !/^sxt_[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const row = (
      await this.db.db
        .select({
          id: schema.extensionInstallations.id,
          userId: schema.extensionInstallations.userId,
          status: schema.users.status,
          lastSeenAt: schema.extensionInstallations.lastSeenAt,
        })
        .from(schema.extensionInstallations)
        .innerJoin(schema.users, eq(schema.users.id, schema.extensionInstallations.userId))
        .where(
          and(
            eq(schema.extensionInstallations.tokenHash, this.hmac("device", token)),
            isNull(schema.extensionInstallations.revokedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!row || row.status !== "active") return undefined;
    const now = this.clock.now();
    if (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.db.db
        .update(schema.extensionInstallations)
        .set({ lastSeenAt: now })
        .where(eq(schema.extensionInstallations.id, row.id));
    }
    return { installationId: row.id, userId: row.userId };
  }

  async list(userId: string) {
    const rows = await this.db.db
      .select()
      .from(schema.extensionInstallations)
      .where(
        and(
          eq(schema.extensionInstallations.userId, userId),
          isNull(schema.extensionInstallations.revokedAt),
        ),
      )
      .orderBy(desc(schema.extensionInstallations.createdAt));
    return {
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      })),
    };
  }

  /** Revokes one of the caller's installations. Takes effect on the next request. */
  async revoke(userId: string, installationId: string): Promise<void> {
    const r = await this.db.db
      .update(schema.extensionInstallations)
      .set({ revokedAt: this.clock.now() })
      .where(
        and(
          eq(schema.extensionInstallations.id, installationId),
          eq(schema.extensionInstallations.userId, userId),
          isNull(schema.extensionInstallations.revokedAt),
        ),
      )
      .returning({ id: schema.extensionInstallations.id });
    if (r.length === 0) throw new ApiError("NOT_FOUND", "Extension not found");
  }
}
