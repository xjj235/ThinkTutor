import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiFail(
  code: string,
  message: string,
  status: number,
  retryable = false,
  details?: unknown,
) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        retryable,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status },
  );
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return apiFail(
      "VALIDATION_ERROR",
      "请求参数不符合要求。",
      400,
      false,
      error.flatten(),
    );
  }

  if (error instanceof AppError) {
    return apiFail(
      error.code,
      error.message,
      error.status,
      error.retryable,
      error.details,
    );
  }

  return apiFail("INTERNAL_ERROR", "服务暂时不可用。", 500, false);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "请求体必须是有效 JSON。", 400);
  }
}
