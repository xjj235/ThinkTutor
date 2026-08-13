import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { entityIdSchema } from "@/lib/domain-schemas";
import { deleteMaterial, getMaterial } from "@/lib/materials";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const requestId = createRequestId(request);
  try { return apiOk(await getMaterial(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id)), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
export async function DELETE(request: Request, { params }: Context) {
  const requestId = createRequestId(request);
  try { assertSameOrigin(request); await deleteMaterial(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), requestId); return apiOk({ deleted: true }, 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
