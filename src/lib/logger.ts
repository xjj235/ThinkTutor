import "server-only";

import pino from "pino";

function safeErrorCode(error: object): string | number | undefined {
  if (!("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

/**
 * Never log exception messages, stacks, causes, request bodies, or provider
 * responses. Those values can contain credentials or student content.
 */
export function safeErrorForLog(error: unknown): { errorType: string; errorCode?: string | number } {
  const errorType = error instanceof Error ? error.name : typeof error;
  const errorCode = error !== null && typeof error === "object" ? safeErrorCode(error) : undefined;
  return errorCode === undefined ? { errorType } : { errorType, errorCode };
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "thinktutor" },
  redact: {
    paths: [
      "password",
      "currentPassword",
      "newPassword",
      "token",
      "authorization",
      "cookie",
      "DEEPSEEK_API_KEY",
      "AI_PSEUDONYM_SECRET",
      "OSS_ACCESS_KEY_SECRET",
      "STORAGE_SIGNING_SECRET",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.token",
      "*.authorization",
      "*.cookie",
      "*.apiKey",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
});
