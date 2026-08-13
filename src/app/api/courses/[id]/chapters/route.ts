import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createChapter } from "@/lib/courses-service";
import { chapterInputSchema, entityIdSchema } from "@/lib/domain-schemas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    return apiOk(await createChapter(await requireUser(["TEACHER", "ADMIN"]), entityIdSchema.parse((await params).id), chapterInputSchema.parse(await readJson(request))), 201, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
