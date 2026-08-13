import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createMaterialUpload, uploadUrlSchema } from "@/lib/materials";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await createMaterialUpload(await requireUser(["TEACHER", "ADMIN"]), uploadUrlSchema.parse(await readJson(request))), 201, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
