import { apiOk, createRequestId, handleRouteError, readJson } from "@/lib/api-response";
import { assertSameOrigin } from "@/lib/auth/request-security";
import { requireUser } from "@/lib/auth/session";
import { createCourse, listCourses } from "@/lib/courses-service";
import { courseInputSchema } from "@/lib/domain-schemas";

export async function GET(request: Request) {
  const requestId = createRequestId(request);
  try { return apiOk(await listCourses(await requireUser()), 200, requestId); }
  catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: Request) {
  const requestId = createRequestId(request);
  try {
    assertSameOrigin(request);
    const user = await requireUser(["TEACHER", "ADMIN"]);
    return apiOk(await createCourse(user, courseInputSchema.parse(await readJson(request)), requestId), 201, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
