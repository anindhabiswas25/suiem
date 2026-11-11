import { type DbHandle, schema } from "@suiem/db";
import { and, eq, gt } from "drizzle-orm";

/** Cache of PUBLIC provider responses (never user data), keyed by provider + request. */
export interface SourceCache {
  get<T>(
    provider: "edgar" | "finnhub",
    key: string,
  ): Promise<{ payload: T; retrievedAt: Date } | undefined>;
  set(provider: "edgar" | "finnhub", key: string, payload: unknown, ttlMs: number): Promise<Date>;
}

export class MemoryCache implements SourceCache {
  private store = new Map<string, { payload: unknown; retrievedAt: Date; expiresAt: number }>();
  async get<T>(provider: string, key: string) {
    const v = this.store.get(`${provider}:${key}`);
    if (!v || v.expiresAt < Date.now()) return undefined;
    return { payload: v.payload as T, retrievedAt: v.retrievedAt };
  }
  async set(provider: string, key: string, payload: unknown, ttlMs: number) {
    const retrievedAt = new Date();
    this.store.set(`${provider}:${key}`, { payload, retrievedAt, expiresAt: Date.now() + ttlMs });
    return retrievedAt;
  }
}

export class DbSourceCache implements SourceCache {
  constructor(private readonly db: DbHandle) {}
  async get<T>(provider: "edgar" | "finnhub", key: string) {
    const row = (
      await this.db.db
        .select()
        .from(schema.researchSourceCache)
        .where(
          and(
            eq(schema.researchSourceCache.provider, provider),
            eq(schema.researchSourceCache.key, key),
            gt(schema.researchSourceCache.expiresAt, new Date()),
          ),
        )
        .limit(1)
    )[0];
    return row ? { payload: row.payload as T, retrievedAt: row.retrievedAt } : undefined;
  }
  async set(provider: "edgar" | "finnhub", key: string, payload: unknown, ttlMs: number) {
    const retrievedAt = new Date();
    const expiresAt = new Date(retrievedAt.getTime() + ttlMs);
    await this.db.db
      .insert(schema.researchSourceCache)
      .values({ provider, key, payload, retrievedAt, expiresAt })
      .onConflictDoUpdate({
        target: [schema.researchSourceCache.provider, schema.researchSourceCache.key],
        set: { payload, retrievedAt, expiresAt },
      });
    return retrievedAt;
  }
}

/** Read-through helper. */
export async function cached<T>(
  cache: SourceCache,
  provider: "edgar" | "finnhub",
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<{ data: T; retrievedAt: Date }> {
  const hit = await cache.get<T>(provider, key);
  if (hit) return { data: hit.payload, retrievedAt: hit.retrievedAt };
  const data = await load();
  const retrievedAt = ttlMs > 0 ? await cache.set(provider, key, data, ttlMs) : new Date();
  return { data, retrievedAt };
}
