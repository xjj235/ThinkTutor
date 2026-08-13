import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { joinClassroom } from "@/lib/courses-service";
import { entityIdSchema, joinClassroomSchema } from "@/lib/domain-schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const input = joinClassroomSchema.parse(await readJson(request));
    return apiOk(await joinClassroom(await requireUser(["STUDENT"]), entityIdSchema.parse((await params).id), input.joinCode, requestId), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
