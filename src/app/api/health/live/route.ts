import { apiOk, createRequestId } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return apiOk({ status: "live", timestamp: new Date().toISOString() }, 200, createRequestId(request));
}
