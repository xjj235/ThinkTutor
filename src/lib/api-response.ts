import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { logger, safeErrorForLog } from "./logger";

const privateResponseHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  vary: "Cookie",
};

// Match the Nginx transport ceiling without imposing a learning word count.
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

export function createRequestId(request?: Request): string {
  const provided = request?.headers.get("x-request-id")?.trim();
  return provided && provided.length <= 100 ? provided : `req_${crypto.randomUUID()}`;
}

export function apiOk<T>(data: T, status = 200, requestId = createRequestId()) {
  return NextResponse.json({ data, requestId }, { status, headers: privateResponseHeaders });
}

export function apiFail(
  code: string,
  message: string,
  status: number,
  retryable = false,
  requestId = createRequestId(),
) {
  return NextResponse.json(
    { error: { code, message, retryable }, requestId },
    { status, headers: privateResponseHeaders },
  );
}

export function handleRouteError(error: unknown, requestId = createRequestId()) {
  if (error instanceof ZodError) {
    return apiFail("VALIDATION_ERROR", "请求参数不符合要求。", 400, false, requestId);
  }
  if (error instanceof AppError) {
    return apiFail(error.code, error.message, error.status, error.retryable, requestId);
  }
  logger.error({ requestId, ...safeErrorForLog(error) }, "Unhandled route error");
  return apiFail("INTERNAL_ERROR", "服务暂时不可用。", 500, false, requestId);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError("VALIDATION_ERROR", "请求必须使用 application/json。", 415);
  }
  const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", "请求数据过大，请拆分后提交。", 413);
  if (Number(request.headers.get("content-length")) > MAX_JSON_BODY_BYTES) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("VALIDATION_ERROR", "请求体必须是有效 JSON。", 400);
  try {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join("")) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION_ERROR", "请求体必须是有效 JSON。", 400);
  } finally {
    reader.releaseLock();
  }
}
