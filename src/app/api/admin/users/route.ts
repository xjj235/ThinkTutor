import { z } from "zod";
import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { listAdminUsers } from "@/lib/admin-service";
import { paginationSchema } from "@/lib/domain-schemas";

export async function GET(request: Request) { const requestId = createRequestId(request); try { await requireUser(["ADMIN"]); const url = new URL(request.url); const input = paginationSchema.extend({ query: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1), role: z.enum(["STUDENT","TEACHER","ADMIN"]).optional(), status: z.enum(["ACTIVE","DISABLED","DELETED"]).optional() }).parse(Object.fromEntries(url.searchParams)); return apiOk(await listAdminUsers(input), 200, requestId); } catch (error) { return handleRouteError(error, requestId); } }
