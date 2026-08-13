import { apiFail, apiOk, createRequestId } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = createRequestId(request);
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redis = getRedis();
    if (redis) { if (redis.status === "wait") await redis.connect(); await redis.ping(); }
    return apiOk({ status: "ready", database: "ok", redis: redis ? "ok" : "not-configured", aiProvider: getServerEnv().AI_PROVIDER, timestamp: new Date().toISOString() }, 200, requestId);
  } catch {
    return apiFail("INTERNAL_ERROR", "服务尚未就绪。", 503, true, requestId);
  }
}
