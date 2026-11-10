import type { Redis } from "ioredis";

/** Single-use, short-lived values in Redis (WebAuthn challenges, SIWE nonces). GETDEL = no replay. */
export async function putOnce(
  redis: Redis,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function takeOnce<T>(redis: Redis, key: string): Promise<T | undefined> {
  const raw = await redis.getdel(key);
  return raw === null ? undefined : (JSON.parse(raw) as T);
}
