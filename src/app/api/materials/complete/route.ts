import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { completeMaterialUpload, completeUploadSchema } from "@/lib/materials";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const input = completeUploadSchema.parse(await readJson(request));
    return apiOk(await completeMaterialUpload(await requireUser(["TEACHER", "ADMIN"]), input.materialId, requestId), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
