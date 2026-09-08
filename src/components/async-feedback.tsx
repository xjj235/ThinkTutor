import { CircleAlert, CircleCheck, LoaderCircle, RotateCcw } from "lucide-react";

export type AsyncFeedbackState = { kind: "idle" | "loading" | "success" | "error"; message: string; retryable?: boolean };

export const idleFeedback: AsyncFeedbackState = { kind: "idle", message: "" };

export function AsyncFeedback({ state, onRetry }: { state: AsyncFeedbackState; onRetry?: () => void }) {
  if (state.kind === "idle") return null;
  const StatusIcon = state.kind === "error" ? CircleAlert : state.kind === "success" ? CircleCheck : LoaderCircle;
  return (
    <div
      className={`async-feedback async-feedback-${state.kind}`}
      role={state.kind === "error" ? "alert" : "status"}
      aria-live={state.kind === "error" ? "assertive" : "polite"}
    >
      <span className="feedback-message">
        <StatusIcon className="feedback-icon" size={20} aria-hidden="true" />
        <span>{state.message}</span>
      </span>
      {state.kind === "error" && state.retryable && onRetry ? (
        <button type="button" className="button button-small button-secondary" onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />重试</button>
      ) : null}
    </div>
  );
}
