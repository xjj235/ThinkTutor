import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { getCourse, updateCourse } from "@/lib/courses-service";
import { coursePatchSchema, entityIdSchema } from "@/lib/domain-schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = createRequestId(request);
  try { return apiOk(await getCourse(await requireUser(), entityIdSchema.parse((await context.params).id)), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await updateCourse(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await context.params).id), coursePatchSchema.parse(await readJson(request)), requestId), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
