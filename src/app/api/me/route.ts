import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { deleteAccountSchema, updateProfileSchema } from "@/lib/auth/schemas";
import { deleteUserAccount, updateUserProfile } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = createRequestId(request);
  try {
    return apiOk(await requireUser(), 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = updateProfileSchema.parse(await readJson(request));
    return apiOk(await updateUserProfile(user.id, input.name), 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = deleteAccountSchema.parse(await readJson(request));
    await deleteUserAccount(user.id, input.password, requestId);
    return apiOk({ deleted: true }, 200, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
