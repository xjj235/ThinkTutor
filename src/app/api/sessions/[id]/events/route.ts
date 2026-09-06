import { z } from "zod";
import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { requireStudentSession } from "@/lib/permissions";
import { sessionIdSchema, retryInputSchema } from "@/lib/contracts";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";

export const runtime = "nodejs";
const inputSchema = retryInputSchema.extend({ action: z.enum(["GOAL_CONFIRMED", "SESSION_RESUMED"]) }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const id = sessionIdSchema.parse((await params).id);
    await requireStudentSession(await requireUser(), id);
    return apiOk(await submitV12SessionEvent(id, inputSchema.parse(await readJson(request))), 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
