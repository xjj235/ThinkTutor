import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { listAIUsage } from "@/lib/admin-service";
import { paginationSchema } from "@/lib/domain-schemas";

export async function GET(request: Request) { const requestId = createRequestId(request); try { await requireUser(["ADMIN"]); const limit = paginationSchema.pick({ limit: true }).parse(Object.fromEntries(new URL(request.url).searchParams)).limit; return apiOk(await listAIUsage(limit), 200, requestId); } catch (error) { return handleRouteError(error, requestId); } }
