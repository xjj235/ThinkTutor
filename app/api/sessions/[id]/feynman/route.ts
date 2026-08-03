import { apiOk, handleRouteError, readJson } from "@/lib/api-response";
import { feynmanInputSchema, sessionIdSchema } from "@/lib/contracts";
import { submitFeynmanExplanation } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    const input = feynmanInputSchema.parse(await readJson(request));
    return apiOk(await submitFeynmanExplanation(id, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
