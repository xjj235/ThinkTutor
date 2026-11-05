import { listAIUsagePage } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { aiOperationLabel, aiOperationLabels, aiUsageStatusLabel, aiUsageStatusLabels } from "@/lib/display-labels";
import { AdminFilterError, AdminLogFilters } from "@/components/admin-log-filters";
import { Pagination } from "@/components/pagination";
import { adminSearchValues, aiUsageListSchema } from "@/lib/admin-list-query";
import type { SearchParams } from "@/lib/list-query";

export default async function AdminAIPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageUser(["ADMIN"]);
  const values = adminSearchValues(await searchParams);
  const parsed = aiUsageListSchema.safeParse({ ...values, limit: 20 });
  const data = parsed.success ? await listAIUsagePage(parsed.data) : null;
  const rows = data?.items ?? [];

  return (
    <PageShell
      title="AI 使用"
      description="日志不包含 API Key、完整提示词或学生敏感原文。"
    >
      <AdminLogFilters pathname="/admin/ai" values={values} queryLabel="模型、提供方、错误码或请求 ID">
        <label>状态<select name="status" defaultValue={values.status ?? ""}><option value="">全部状态</option>{Object.entries(aiUsageStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>操作<select name="operation" defaultValue={values.operation ?? ""}><option value="">全部操作</option>{Object.entries(aiOperationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </AdminLogFilters>
      {!data ? <AdminFilterError /> : rows.length ? (
        <div className="table-wrap">
          <table>
            <caption>共 {data.total} 条 AI 使用记录 · 第 {data.page} 页</caption>
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>操作</th>
                <th>状态</th>
                <th>Token</th>
                <th>耗时</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Shanghai" }).format(row.createdAt)}</td>
                  <td>{row.model}</td>
                  <td>{aiOperationLabel(row.operation)}</td>
                  <td>{aiUsageStatusLabel(row.status, row.errorCode)}</td>
                  <td>{(row.promptTokens ?? 0) + (row.completionTokens ?? 0)}</td>
                  <td>{row.latencyMs} ms</td>
                  <td>{row.errorCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="没有匹配的 AI 使用记录" description="调整筛选条件或清除筛选后重试；系统产生模型调用后会显示记录。" />
      )}
      {data ? <Pagination pathname="/admin/ai" page={data.page} totalPages={data.totalPages} query={{ query: values.query, status: values.status, operation: values.operation, from: values.from, to: values.to }} /> : null}
    </PageShell>
  );
}
