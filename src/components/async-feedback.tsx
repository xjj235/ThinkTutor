export type AsyncFeedbackState = { kind: "idle" | "loading" | "success" | "error"; message: string; retryable?: boolean };

export const idleFeedback: AsyncFeedbackState = { kind: "idle", message: "" };

export function AsyncFeedback({ state, onRetry }: { state: AsyncFeedbackState; onRetry?: () => void }) {
  if (state.kind === "idle") return null;
  return (
    <div
      className={`async-feedback async-feedback-${state.kind}`}
      role={state.kind === "error" ? "alert" : "status"}
      aria-live={state.kind === "error" ? "assertive" : "polite"}
    >
      <span>{state.message}</span>
      {state.kind === "error" && state.retryable && onRetry ? (
        <button type="button" className="button button-small button-secondary" onClick={onRetry}>重试</button>
      ) : null}
    </div>
  );
}
