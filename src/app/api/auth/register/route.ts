import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { registerSchema } from "@/lib/auth/schemas";
import { registerStudent } from "@/lib/auth/service";
import { limitRegistration } from "@/lib/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    await limitRegistration(request);
    const input = registerSchema.parse(await readJson(request));
    return apiOk(await registerStudent(input, requestId), 201, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
