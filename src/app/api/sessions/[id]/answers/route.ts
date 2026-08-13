import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { requireStudentSession } from "@/lib/permissions";
import { answerInputSchema, sessionIdSchema } from "@/lib/contracts";
import { submitLearningAnswer } from "@/lib/session-service";

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
    const input = answerInputSchema.parse(await readJson(request));
    return apiOk(await submitLearningAnswer(id, input), 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
