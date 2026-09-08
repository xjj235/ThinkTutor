import "server-only";

import { createHash } from "node:crypto";
import { getServerEnv } from "./env";
import { AppError } from "./errors";
import { acquireLock, consumeRateLimit } from "./redis";

export function requestClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwarded ?? request.headers.get("x-real-ip") ?? "unknown";
  return createHash("sha256").update(`thinktutor:${source}`).digest("hex").slice(0, 32);
}

export async function limitLogin(request: Request): Promise<void> {
  const env = getServerEnv();
  await consumeRateLimit(`rate:login:${requestClientKey(request)}`, env.RATE_LIMIT_LOGIN_PER_15M, 15 * 60);
}

export async function limitRegistration(request: Request): Promise<void> {
  const env = getServerEnv();
  await consumeRateLimit(`rate:register:${requestClientKey(request)}`, env.RATE_LIMIT_REGISTER_PER_HOUR, 60 * 60);
}

export async function withAIRequestProtection<T>(userId: string, sessionKey: string, operation: () => Promise<T>, sequentialCallsPerAttempt: 1 | 2 = 1): Promise<T> {
  const env = getServerEnv();
  await Promise.all([
    consumeRateLimit(`rate:ai:minute:${userId}`, env.RATE_LIMIT_AI_PER_MINUTE, 60),
    consumeRateLimit(`rate:ai:day:${userId}`, env.RATE_LIMIT_AI_PER_DAY, 24 * 60 * 60),
  ]);
  const release = await acquireLock(`lock:ai:${sessionKey}`, env.DEEPSEEK_TIMEOUT_MS * sequentialCallsPerAttempt * (env.AI_MAX_RETRIES + 1) + 10_000);
  if (!release) throw new AppError("CONFLICT", "该学习会话正在生成内容，请稍候。", 409, true);
  try { return await operation(); }
  finally { await release(); }
}
