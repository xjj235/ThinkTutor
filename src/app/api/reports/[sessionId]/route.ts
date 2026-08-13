import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { requireSessionAccess } from "@/lib/permissions";
import { sessionIdSchema } from "@/lib/contracts";
import { getReportPayload } from "@/lib/session-service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const requestId = createRequestId(request);
  try {
    const { sessionId: rawSessionId } = await params;
    const sessionId = sessionIdSchema.parse(rawSessionId);
    await requireSessionAccess(await requireUser(), sessionId);
    return apiOk(await getReportPayload(sessionId), 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
