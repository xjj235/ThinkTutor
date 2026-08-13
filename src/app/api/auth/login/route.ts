import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { loginSchema } from "@/lib/auth/schemas";
import { loginUser } from "@/lib/auth/service";
import { limitLogin } from "@/lib/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    await limitLogin(request);
    return apiOk(await loginUser(loginSchema.parse(await readJson(request)), requestId), 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
