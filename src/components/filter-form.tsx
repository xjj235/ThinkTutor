export function FilterForm({ children, resetHref }: { children: React.ReactNode; resetHref: string }) {
  return (
    <form className="filter-form" method="get">
      {children}
      <div className="inline-controls">
        <button className="button button-small" type="submit">筛选</button>
        <a className="button button-small button-secondary" href={resetHref}>清除</a>
      </div>
    </form>
  );
}
