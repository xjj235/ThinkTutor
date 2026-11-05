import { publicErrorMessage } from "./errors";

export interface ClientApiErrorBody { error?: { code?: string; message?: string; retryable?: boolean } }

export class ClientApiError extends Error {
  readonly retryable: boolean;
  readonly code?: string;
  constructor(message: string, retryable: boolean, code?: string) {
    super(publicErrorMessage(code, message));
    this.name = "ClientApiError";
    this.retryable = retryable;
    this.code = code;
  }
}

export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as ClientApiErrorBody & { data?: T };
  if (!response.ok || body.data === undefined) {
    throw new ClientApiError(body.error?.message ?? fallback, body.error?.retryable ?? response.status >= 500, body.error?.code);
  }
  return body.data;
}

export function feedbackForError(error: unknown, fallback: string) {
  return {
    kind: "error" as const,
    message: error instanceof ClientApiError ? error.message : fallback,
    retryable: error instanceof ClientApiError ? error.retryable : true,
  };
}
