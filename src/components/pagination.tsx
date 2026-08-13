import Link from "next/link";

function pageHref(pathname: string, query: Record<string, string | undefined>, page: number): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) parameters.set(key, value);
  parameters.set("page", String(page));
  return `${pathname}?${parameters.toString()}`;
}

export function Pagination({ pathname, page, totalPages, query = {} }: { pathname: string; page: number; totalPages: number; query?: Record<string, string | undefined> }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="分页">
      {page > 1 ? <Link className="button button-secondary button-small" href={pageHref(pathname, query, page - 1)}>上一页</Link> : <span />}
      <span aria-live="polite">第 {page} / {totalPages} 页</span>
      {page < totalPages ? <Link className="button button-secondary button-small" href={pageHref(pathname, query, page + 1)}>下一页</Link> : <span />}
    </nav>
  );
}
