import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { updateGoal } from "@/lib/courses-service";
import { entityIdSchema, goalPatchSchema } from "@/lib/domain-schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await updateGoal(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), goalPatchSchema.parse(await readJson(request))), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
