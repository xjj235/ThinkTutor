import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createGoal } from "@/lib/courses-service";
import { entityIdSchema, goalInputSchema } from "@/lib/domain-schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await createGoal(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), goalInputSchema.parse(await readJson(request))), 201, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
