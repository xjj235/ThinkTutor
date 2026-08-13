import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { requireSessionAccess } from "@/lib/permissions";
import { sessionIdSchema } from "@/lib/contracts";
import { getSessionPayload } from "@/lib/session-service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId(request);
  try {
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    await requireSessionAccess(await requireUser(), id);
    return apiOk(await getSessionPayload(id), 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
