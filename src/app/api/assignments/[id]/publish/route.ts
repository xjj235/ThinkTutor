import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { publishAssignment } from "@/lib/courses-service";
import { entityIdSchema } from "@/lib/domain-schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await publishAssignment(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), requestId), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
