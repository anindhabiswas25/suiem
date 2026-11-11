import type { Redis } from "ioredis";

/** Daily per-user research limit and per-provider token budgets (free-tier protection). */
export interface Quota {
  /** Counts one brief generation for the user today; returns false when over the limit. */
  takeBrief(userId: string, limit: number, now: Date): Promise<boolean>;
  /** Refund when a brief was not generated (e.g. both providers failed). */
  refundBrief(userId: string, now: Date): Promise<void>;
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

export class RedisQuota implements Quota {
  constructor(private readonly redis: Redis) {}
  async takeBrief(userId: string, limit: number, now: Date) {
    const key = `research:quota:${userId}:${day(now)}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 2 * 86_400);
    if (n > limit) {
      await this.redis.decr(key);
      return false;
    }
    return true;
  }
  async refundBrief(userId: string, now: Date) {
    await this.redis.decr(`research:quota:${userId}:${day(now)}`);
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
  async takeBrief(userId: string, limit: number, now: Date) {
    const k = `${userId}:${day(now)}`;
    const n = (this.briefs.get(k) ?? 0) + 1;
    if (n > limit) return false;
    this.briefs.set(k, n);
    return true;
  }
  async refundBrief(userId: string, now: Date) {
    const k = `${userId}:${day(now)}`;
    this.briefs.set(k, Math.max(0, (this.briefs.get(k) ?? 0) - 1));
  }
  async tokensUsed(provider: string, now: Date) {
    return this.tokens.get(`${provider}:${day(now)}`) ?? 0;
  }
  async addTokens(provider: string, tokens: number, now: Date) {
    const k = `${provider}:${day(now)}`;
    this.tokens.set(k, (this.tokens.get(k) ?? 0) + tokens);
  }
}
