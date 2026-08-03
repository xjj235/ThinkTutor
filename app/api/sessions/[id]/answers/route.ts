import { apiOk, handleRouteError, readJson } from "@/lib/api-response";
import { answerInputSchema, sessionIdSchema } from "@/lib/contracts";
import { submitLearningAnswer } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = sessionIdSchema.parse(rawId);
    const input = answerInputSchema.parse(await readJson(request));
    return apiOk(await submitLearningAnswer(id, input));
  } catch (error) {
    return handleRouteError(error);
  }
}
