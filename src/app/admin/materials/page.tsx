import { listMaterialJobsPage } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell, EmptyState } from "@/components/page-shell";
import { MaterialActions } from "@/components/material-actions";
import { materialStatusLabels } from "@/lib/display-labels";
import { AdminFilterError, AdminLogFilters } from "@/components/admin-log-filters";
import { Pagination } from "@/components/pagination";
import { adminSearchValues, materialJobListSchema } from "@/lib/admin-list-query";
import type { SearchParams } from "@/lib/list-query";

export default async function AdminMaterialsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageUser(["ADMIN"]);
  const values = adminSearchValues(await searchParams);
  const parsed = materialJobListSchema.safeParse({ ...values, limit: 20 });
  const data = parsed.success ? await listMaterialJobsPage(parsed.data) : null;
  return <PageShell title="材料处理任务" description="按更新时间查询材料；默认显示等待处理、处理中、失败及不支持的任务。">
    <AdminLogFilters pathname="/admin/materials" values={values} queryLabel="材料标题或文件名">
      <label>状态<select name="status" defaultValue={values.status ?? ""}>
        <option value="">待处理与异常任务</option>
        {Object.entries(materialStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </AdminLogFilters>
    {!data ? <AdminFilterError /> : data.items.length ? <>
      <p>共 {data.total} 条材料记录 · 第 {data.page} 页</p>
      <div className="data-list">{data.items.map((job) => <div className="data-row material-row" key={job.id}>
        <span className="data-row-detail"><strong>{job.title}</strong><small>{job.originalName} · {job.failureMessage ?? "暂无错误信息"}</small><small>更新于 {job.updatedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></span>
        <div><span className="badge">{materialStatusLabels[job.status]} · 重试 {job.retryCount}</span><MaterialActions id={job.id} title={job.title} status={job.status} allowDelete={false} /></div>
      </div>)}</div>
    </> : <EmptyState title="没有匹配的材料任务" description="调整筛选条件或清除筛选后重试。" />}
    {data ? <Pagination pathname="/admin/materials" page={data.page} totalPages={data.totalPages} query={{ query: values.query, status: values.status, from: values.from, to: values.to }} /> : null}
  </PageShell>;
}
