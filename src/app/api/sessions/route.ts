import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createSessionInputSchema } from "@/lib/contracts";
import { createLearningSession } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = createSessionInputSchema.parse(await readJson(request));
    const payload = await createLearningSession(user.id, input);
    return apiOk(payload, 201, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
