export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status = 500,
    retryable = false,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export class AIProviderError extends AppError {
  constructor(code: string, message: string, status = 503, retryable = true) {
    super(code, message, status, retryable);
    this.name = "AIProviderError";
  }
}

const aiErrorMessages: Readonly<Record<string, string>> = {
  AI_INVALID_OUTPUT: "学习教练暂时未能生成回复，请重试。",
  AI_TIMEOUT: "本次等待超时，请重试。",
  AI_RATE_LIMITED: "学习服务当前较忙，请稍后重试。",
};

// Keep provider details on the server-side error while sharing one public
// mapping between API responses and clients receiving an older response.
export function publicErrorMessage(code: string | undefined, message: string): string {
  if (!code?.startsWith("AI_")) return message;
  return aiErrorMessages[code] ?? "学习服务暂时不可用，请稍后重试。";
}
