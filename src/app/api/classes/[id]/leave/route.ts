import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { leaveClassroom } from "@/lib/courses-service";
import { entityIdSchema } from "@/lib/domain-schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    await leaveClassroom(await requireUser(["STUDENT"]), entityIdSchema.parse((await params).id), requestId);
    return apiOk({ left: true }, 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
