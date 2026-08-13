import { z } from "zod";
import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { changeUserStatus } from "@/lib/admin-service";
import { entityIdSchema } from "@/lib/domain-schemas";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { const requestId = createRequestId(request); try { assertSameOrigin(request); const actor = await requireUser(["ADMIN"]); const { id } = await context.params; const { status } = z.object({ status: z.enum(["ACTIVE", "DISABLED", "DELETED"]) }).strict().parse(await readJson(request)); return apiOk(await changeUserStatus(actor.id, entityIdSchema.parse(id), status, requestId), 200, requestId); } catch (error) { return handleRouteError(error, requestId); } }
