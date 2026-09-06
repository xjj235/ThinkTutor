import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { reviewClaim } from "@/lib/knowledge/review-service";
export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try { assertSameOrigin(request); await reviewClaim(await requireUser(), await readJson(request)); return apiOk({ saved: true }, 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
