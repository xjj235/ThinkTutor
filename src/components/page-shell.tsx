export function PageShell({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <main id="main-content" className="page-shell"><header className="page-heading"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="page-actions">{actions}</div> : null}</header><div className="page-content">{children}</div></main>;
}

export function EmptyState({ title, description }: { title: string; description: string }) { return <div className="empty-state"><h2>{title}</h2><p>{description}</p></div>; }

export function StatCard({ label, value, note }: { label: string; value: string | number; note?: string }) { return <article className="stat-card"><p>{label}</p><strong>{value}</strong>{note ? <small>{note}</small> : null}</article>; }
