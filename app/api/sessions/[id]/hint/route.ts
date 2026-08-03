import { apiOk, handleRouteError, readJson } from "@/lib/api-response";
import { hintInputSchema, sessionIdSchema } from "@/lib/contracts";
import { requestHint } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    const input = hintInputSchema.parse(await readJson(request));
    return apiOk(await requestHint(id, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
