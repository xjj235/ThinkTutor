import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createAssignment } from "@/lib/courses-service";
import { assignmentInputSchema } from "@/lib/domain-schemas";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await createAssignment(await requireUser(["TEACHER", "ADMIN"]), assignmentInputSchema.parse(await readJson(request))), 201, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
