import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { deleteChapter, updateChapter } from "@/lib/courses-service";
import { chapterPatchSchema, entityIdSchema } from "@/lib/domain-schemas";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await updateChapter(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), chapterPatchSchema.parse(await readJson(request))), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function DELETE(request: Request, { params }: Context) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    await deleteChapter(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id));
    return apiOk({ deleted: true }, 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
