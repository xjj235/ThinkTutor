import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { getTeacherClassAnalytics } from "@/lib/analytics-service";
import { entityIdSchema } from "@/lib/domain-schemas";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try { const user = await requireUser(["TEACHER", "ADMIN"]); const { id } = await context.params; return apiOk(await getTeacherClassAnalytics(user, entityIdSchema.parse(id)), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
