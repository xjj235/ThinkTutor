import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { changePasswordSchema } from "@/lib/auth/schemas";
import { changeUserPassword } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = changePasswordSchema.parse(await readJson(request));
    await changeUserPassword(user.id, input.currentPassword, input.newPassword, requestId);
    return apiOk({ changed: true, loginRequired: true }, 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
