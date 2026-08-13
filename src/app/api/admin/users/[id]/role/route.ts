import { z } from "zod";
import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { changeUserRole } from "@/lib/admin-service";
import { entityIdSchema } from "@/lib/domain-schemas";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { const requestId = createRequestId(request); try { assertSameOrigin(request); const actor = await requireUser(["ADMIN"]); const { id } = await context.params; const { role } = z.object({ role: z.enum(["STUDENT", "TEACHER", "ADMIN"]) }).strict().parse(await readJson(request)); return apiOk(await changeUserRole(actor.id, entityIdSchema.parse(id), role, requestId), 200, requestId); } catch (error) { return handleRouteError(error, requestId); } }
