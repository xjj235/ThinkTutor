import "server-only";

import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getServerEnv } from "./env";
import { AppError } from "./errors";

let redis: Redis | null | undefined;
const memoryCounters = new Map<string, { count: number; expiresAt: number }>();
const memoryLocks = new Map<string, { token: string; expiresAt: number }>();

export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = getServerEnv().REDIS_URL;
  redis = url ? new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true }) : null;
  return redis;
}

export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ remaining: number; resetAt: number }> {
  const client = getRedis();
  const now = Date.now();
  if (!client) {
    const current = memoryCounters.get(key);
    const entry = !current || current.expiresAt <= now ? { count: 0, expiresAt: now + windowSeconds * 1_000 } : current;
    entry.count += 1;
    memoryCounters.set(key, entry);
    if (entry.count > limit) throw new AppError("RATE_LIMITED", "请求过于频繁，请稍后重试。", 429, true);
    return { remaining: Math.max(0, limit - entry.count), resetAt: entry.expiresAt };
  }
  if (client.status === "wait") await client.connect();
  const count = await client.incr(key);
  if (count === 1) await client.expire(key, windowSeconds);
  const ttl = await client.ttl(key);
  if (count > limit) throw new AppError("RATE_LIMITED", "请求过于频繁，请稍后重试。", 429, true);
  return { remaining: Math.max(0, limit - count), resetAt: now + Math.max(ttl, 0) * 1_000 };
}

export async function acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const client = getRedis();
  if (!client) {
    const now = Date.now();
    const current = memoryLocks.get(key);
    if (current && current.expiresAt > now) return null;
    const token = randomUUID();
    memoryLocks.set(key, { token, expiresAt: now + ttlMs });
    return async () => {
      const currentLock = memoryLocks.get(key);
      if (currentLock?.token === token) memoryLocks.delete(key);
    };
  }
  if (client.status === "wait") await client.connect();
  const token = randomUUID();
  const acquired = await client.set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return null;
  return async () => {
    await client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  };
}
