import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createClassroom } from "@/lib/courses-service";
import { classroomInputSchema } from "@/lib/domain-schemas";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await createClassroom(await requireUser(["TEACHER", "ADMIN"]), classroomInputSchema.parse(await readJson(request)), requestId), 201, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
