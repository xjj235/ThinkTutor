import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { getAssignment, updateAssignment } from "@/lib/courses-service";
import { assignmentPatchSchema, entityIdSchema } from "@/lib/domain-schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const requestId = createRequestId(request);
  try { return apiOk(await getAssignment(await requireUser(), entityIdSchema.parse((await params).id)), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}

export async function PATCH(request: Request, { params }: Context) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await updateAssignment(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), assignmentPatchSchema.parse(await readJson(request))), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
