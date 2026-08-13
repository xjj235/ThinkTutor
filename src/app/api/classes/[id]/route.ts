import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { getClassroom } from "@/lib/courses-service";
import { entityIdSchema } from "@/lib/domain-schemas";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try { return apiOk(await getClassroom(await requireUser(), entityIdSchema.parse((await params).id)), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
