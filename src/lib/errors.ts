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
