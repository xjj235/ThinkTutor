import type { ReactNode } from "react";
import { CircleAlert, LoaderCircle, SearchX } from "lucide-react";

type WorkspaceStateProps = {
  variant: "loading" | "error" | "not-found";
  title: string;
  description: string;
  actions?: ReactNode;
};

const stateIcons = {
  loading: LoaderCircle,
  error: CircleAlert,
  "not-found": SearchX,
};

export function WorkspaceState({
  variant,
  title,
  description,
  actions,
}: WorkspaceStateProps) {
  const Icon = stateIcons[variant];

  return (
    <section className="workspace-state" data-variant={variant}>
      <div className="state-symbol" aria-hidden="true">
        <Icon
          size={28}
          className={variant === "loading" ? "motion-safe:animate-spin" : undefined}
        />
      </div>
      <div
        className="state-copy"
        role={variant === "error" ? "alert" : "status"}
        aria-atomic="true"
      >
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {variant === "loading" ? (
        <div className="skeleton-lines" aria-hidden="true">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ) : null}
      {actions ? <div className="state-actions flex flex-wrap gap-3">{actions}</div> : null}
    </section>
  );
}
