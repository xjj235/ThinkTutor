import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { getAdminOverview } from "@/lib/admin-service";

export async function GET(request: Request) { const requestId = createRequestId(request); try { await requireUser(["ADMIN"]); return apiOk(await getAdminOverview(), 200, requestId); } catch (error) { return handleRouteError(error, requestId); } }
