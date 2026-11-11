import type { Redis } from "ioredis";

/** Daily per-user research limit and per-provider token budgets (free-tier protection). */
export interface Quota {
  /**
   * Takes one slot for the user today. Returns the slot (the day it was counted on) or null when
   * over the limit. `scope` separates briefs, follow-up questions and thesis drafts.
   */
  take(userId: string, limit: number, now: Date, scope?: QuotaScope): Promise<QuotaSlot | null>;
  /** Gives a slot back ONLY when no model tokens were spent. Never goes below zero. */
  refund(slot: QuotaSlot): Promise<void>;
  tokensUsed(provider: string, now: Date): Promise<number>;
  addTokens(provider: string, tokens: number, now: Date): Promise<void>;
}

/** Daily token budgets, kept under the free-plan limits (Groq ≈ 200K TPD). */
export const TOKEN_BUDGET: Record<string, number> = {
  groq: 180_000,
  gemini: 500_000,
  mock: Number.MAX_SAFE_INTEGER,
};

const day = (d: Date) => d.toISOString().slice(0, 10);
export type QuotaScope = "brief" | "question" | "draft";
export interface QuotaSlot {
  key: string;
}
const slotKey = (userId: string, now: Date, scope: QuotaScope) =>
  `research:quota:${scope}:${userId}:${day(now)}`;
/** DECR only while the counter is positive (atomic). */
const DECR_POSITIVE =
  "local v = tonumber(redis.call('get', KEYS[1]) or '0') if v > 0 then return redis.call('decr', KEYS[1]) end return 0";

export class RedisQuota implements Quota {
  constructor(private readonly redis: Redis) {}
  async take(userId: string, limit: number, now: Date, scope: QuotaScope = "brief") {
    const key = slotKey(userId, now, scope);
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 2 * 86_400);
    if (n > limit) {
      await this.redis.eval(DECR_POSITIVE, 1, key);
      return null;
    }
    return { key };
  }
  async refund(slot: QuotaSlot) {
    await this.redis.eval(DECR_POSITIVE, 1, slot.key);
  }
  async tokensUsed(provider: string, now: Date) {
    return Number((await this.redis.get(`research:tokens:${provider}:${day(now)}`)) ?? 0);
  }
  async addTokens(provider: string, tokens: number, now: Date) {
    const key = `research:tokens:${provider}:${day(now)}`;
    await this.redis.incrby(key, Math.max(0, Math.round(tokens)));
    await this.redis.expire(key, 2 * 86_400);
  }
}

export class MemoryQuota implements Quota {
  readonly briefs = new Map<string, number>();
  readonly tokens = new Map<string, number>();
  async take(userId: string, limit: number, now: Date, scope: QuotaScope = "brief") {
    const key = slotKey(userId, now, scope);
    const n = (this.briefs.get(key) ?? 0) + 1;
    if (n > limit) return null;
    this.briefs.set(key, n);
    return { key };
  }
  async refund(slot: QuotaSlot) {
    this.briefs.set(slot.key, Math.max(0, (this.briefs.get(slot.key) ?? 0) - 1));
  }
  async tokensUsed(provider: string, now: Date) {
    return this.tokens.get(`${provider}:${day(now)}`) ?? 0;
  }
  async addTokens(provider: string, tokens: number, now: Date) {
    const k = `${provider}:${day(now)}`;
    this.tokens.set(k, (this.tokens.get(k) ?? 0) + tokens);
  }
}
