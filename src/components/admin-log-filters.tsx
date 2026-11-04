import { FilterForm } from "./filter-form";

export function AdminLogFilters({ pathname, values, queryLabel, children }: {
  pathname: string;
  values: Record<string, string | undefined>;
  queryLabel: string;
  children?: React.ReactNode;
}) {
  return <FilterForm resetHref={pathname}>
    <label>{queryLabel}<input name="query" defaultValue={values.query} maxLength={120} /></label>
    {children}
    <label>开始日期（北京时间）<input type="date" name="from" defaultValue={values.from} /></label>
    <label>结束日期（北京时间）<input type="date" name="to" defaultValue={values.to} /></label>
  </FilterForm>;
}

export function AdminFilterError() {
  return <p role="alert">筛选条件无效，请检查日期范围、状态和页码，或清除筛选后重试。</p>;
}
