import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { type DbHandle, schema } from "@suiem/db";
import { FEATURE_FLAGS, type FeatureFlag, HARD_OFF_FLAGS } from "@suiem/shared/policy";
import { eq } from "drizzle-orm";
import { ApiError } from "../http/errors";
import { DB, ENV } from "../tokens";

/**
 * Simple flags: DB table, overridden by FLAG_* env vars (PO decision). `trading.live` is
 * hard-off: there is no env override for it, set() refuses it, and the DB CHECK rejects it.
 */
@Injectable()
export class FlagsService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ENV) private readonly env: ApiEnv,
  ) {}

  private envOverride(key: FeatureFlag): boolean | undefined {
    if (key === "trading.testnet") return this.env.FLAG_TRADING_TESTNET;
    if (key === "elections") return this.env.FLAG_ELECTIONS;
    if (key === "campaigns") return this.env.FLAG_CAMPAIGNS;
    return undefined;
  }

  async all(): Promise<Record<FeatureFlag, boolean>> {
    const rows = await this.db.db.select().from(schema.featureFlags);
    const stored = new Map(rows.map((r) => [r.key, r.enabled]));
    const out = {} as Record<FeatureFlag, boolean>;
    for (const key of FEATURE_FLAGS) {
      out[key] = HARD_OFF_FLAGS.includes(key)
        ? false
        : (this.envOverride(key) ?? stored.get(key) ?? false);
    }
    return out;
  }

  async isEnabled(key: FeatureFlag): Promise<boolean> {
    return (await this.all())[key];
  }

  /** Used by ops scripts/tests only; there is no HTTP route for it. */
  async set(key: FeatureFlag, enabled: boolean): Promise<void> {
    if (HARD_OFF_FLAGS.includes(key) && enabled)
      throw new ApiError("FLAG_LOCKED", `${key} is hard-off and cannot be enabled`);
    await this.db.db
      .update(schema.featureFlags)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(schema.featureFlags.key, key));
  }
}
