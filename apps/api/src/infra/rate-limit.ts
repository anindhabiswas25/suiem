import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { ApiError } from "../http/errors";
import { ENV, REDIS } from "../tokens";

export interface LimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export const LIMITS = {
  globalPerIp: { bucket: "ip", limit: 600, windowSeconds: 60 },
  authPerIp: { bucket: "auth-ip", limit: 60, windowSeconds: 600 },
  writesPerUser: { bucket: "writes-user", limit: 300, windowSeconds: 600 },
  // Social (PRD §9.3): posts 10/hour, comments 30/hour, helpful votes 50/day per user.
  postsPerUser: { bucket: "posts-user", limit: 10, windowSeconds: 3600 },
  commentsPerUser: { bucket: "comments-user", limit: 30, windowSeconds: 3600 },
  helpfulPerUser: { bucket: "helpful-user", limit: 50, windowSeconds: 86_400 },
  // each vote preview costs several mainnet RPC calls (QuickNode plan limits).
  votePreviewsPerUser: { bucket: "vote-preview-user", limit: 30, windowSeconds: 600 },
} satisfies Record<string, LimitRule>;

/** Fixed-window counters in Redis. Subjects are hashed, so no IP is stored in clear. */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: ApiEnv,
  ) {}

  async consume(rule: LimitRule, subject: string): Promise<void> {
    if (this.env.RATE_LIMIT_DISABLED) return;
    const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const hashed = createHash("sha256")
      .update(`${rule.bucket}:${subject}`)
      .digest("hex")
      .slice(0, 32);
    const key = `rl:${rule.bucket}:${hashed}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, rule.windowSeconds);
    if (count > rule.limit) {
      const retryAfter = rule.windowSeconds - (Math.floor(Date.now() / 1000) % rule.windowSeconds);
      throw new ApiError("RATE_LIMITED", "Too many requests. Try again later.", undefined, {
        "retry-after": String(retryAfter),
      });
    }
  }
}
