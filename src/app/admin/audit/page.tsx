import { listAuditLogsPage } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { auditActionLabels, auditTargetTypeLabel } from "@/lib/display-labels";
import { AdminFilterError, AdminLogFilters } from "@/components/admin-log-filters";
import { Pagination } from "@/components/pagination";
import { adminSearchValues, auditLogListSchema } from "@/lib/admin-list-query";
import type { SearchParams } from "@/lib/list-query";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageUser(["ADMIN"]);
  const values = adminSearchValues(await searchParams);
  const parsed = auditLogListSchema.safeParse({ ...values, limit: 20 });
  const data = parsed.success ? await listAuditLogsPage(parsed.data) : null;
  const logs = data?.items ?? [];
  return (
    <PageShell title="审计日志" description="仅展示关键操作元数据，不保存密码、密钥或学习正文。">
      <AdminLogFilters pathname="/admin/audit" values={values} queryLabel="操作者、目标 ID 或请求 ID">
        <label>操作<select name="action" defaultValue={values.action ?? ""}><option value="">全部操作</option>{Object.entries(auditActionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </AdminLogFilters>
      {!data ? <AdminFilterError /> : logs.length === 0 ? <EmptyState title="没有匹配的审计事件" description="调整筛选条件或清除筛选后重试。" /> : (
        <div className="table-wrap">
          <table>
            <caption>共 {data.total} 条审计记录 · 第 {data.page} 页</caption>
            <thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>目标</th><th>请求 ID</th></tr></thead>
            <tbody>{logs.map((log) => <tr key={log.id}>
              <td>{log.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td>
              <td>{auditActionLabels[log.action]}</td>
              <td>{log.actor ? `${log.actor.name}（${log.actor.email}）` : "已删除账号或系统"}</td>
              <td>{auditTargetTypeLabel(log.targetType)}{log.targetId ? ` / ${log.targetId}` : ""}</td>
              <td><code>{log.requestId}</code></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {data ? <Pagination pathname="/admin/audit" page={data.page} totalPages={data.totalPages} query={{ query: values.query, action: values.action, from: values.from, to: values.to }} /> : null}
    </PageShell>
  );
}
