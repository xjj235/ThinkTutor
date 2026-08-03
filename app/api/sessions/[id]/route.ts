import { apiOk, handleRouteError } from "@/lib/api-response";
import { sessionIdSchema } from "@/lib/contracts";
import { getSessionPayload } from "@/lib/session-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    return apiOk(await getSessionPayload(id));
  } catch (error) {
    return handleRouteError(error);
  }
}
