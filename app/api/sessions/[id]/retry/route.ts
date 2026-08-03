import { apiOk, handleRouteError, readJson } from "@/lib/api-response";
import { retryInputSchema, sessionIdSchema } from "@/lib/contracts";
import { createRetrySession } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    const body = retryInputSchema.parse(await readJson(request));
    const result = await createRetrySession(id, body);
    return apiOk(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
