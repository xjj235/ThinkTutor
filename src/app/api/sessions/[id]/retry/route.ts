import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { requireStudentSession } from "@/lib/permissions";
import { retryInputSchema, sessionIdSchema } from "@/lib/contracts";
import { createRetrySession } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    await requireStudentSession(await requireUser(), id);
    const body = retryInputSchema.parse(await readJson(request));
    const result = await createRetrySession(id, body);
    return apiOk(result, result.duplicate ? 200 : 201, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
