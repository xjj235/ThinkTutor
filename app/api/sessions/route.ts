import { apiOk, handleRouteError, readJson } from "@/lib/api-response";
import { createSessionInputSchema } from "@/lib/contracts";
import { createLearningSession } from "@/lib/session-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = createSessionInputSchema.parse(await readJson(request));
    const payload = await createLearningSession(input);
    return apiOk(payload, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
