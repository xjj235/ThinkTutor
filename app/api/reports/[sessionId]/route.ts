import { apiOk, handleRouteError } from "@/lib/api-response";
import { sessionIdSchema } from "@/lib/contracts";
import { getReportPayload } from "@/lib/session-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId: rawSessionId } = await params;
    const sessionId = sessionIdSchema.parse(rawSessionId);
    return apiOk(await getReportPayload(sessionId));
  } catch (error) {
    return handleRouteError(error);
  }
}
