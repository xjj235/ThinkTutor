import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/session";
import { getStudentAnalytics } from "@/lib/analytics-service";

export async function GET(request: Request) {
  const requestId = createRequestId(request);
  try { const user = await requireUser(["STUDENT"]); return apiOk(await getStudentAnalytics(user.id), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}
