import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { reviewRelease } from "@/lib/knowledge/review-service";
export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try { assertSameOrigin(request); const result = await reviewRelease(await requireUser(), await readJson(request)); return apiOk({ id: result.id }, 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
