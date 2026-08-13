export interface ClientApiErrorBody { error?: { message?: string; retryable?: boolean } }

export class ClientApiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ClientApiError";
    this.retryable = retryable;
  }
}

export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as ClientApiErrorBody & { data?: T };
  if (!response.ok || body.data === undefined) {
    throw new ClientApiError(body.error?.message ?? fallback, body.error?.retryable ?? response.status >= 500);
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
