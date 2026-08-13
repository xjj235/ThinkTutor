import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { logoutUser } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await logoutUser(user.id, requestId);
    return apiOk({ loggedOut: true }, 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
