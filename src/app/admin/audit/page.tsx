import { listAuditLogs } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { auditActionLabels, auditTargetTypeLabel } from "@/lib/display-labels";

export default async function AdminAuditPage() {
  await requirePageUser(["ADMIN"]);
  const logs = await listAuditLogs(100);
  return (
    <PageShell title="审计日志" description="仅展示关键操作元数据，不保存密码、密钥或学习正文。">
      {logs.length === 0 ? <EmptyState title="暂无审计事件" description="关键身份或业务操作发生后，审计记录会显示在这里。" /> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">最近 100 条关键操作审计记录</caption>
            <thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>目标</th><th>请求 ID</th></tr></thead>
            <tbody>{logs.map((log) => <tr key={log.id}>
              <td>{log.createdAt.toLocaleString("zh-CN")}</td>
              <td>{auditActionLabels[log.action]}</td>
              <td>{log.actor ? `${log.actor.name}（${log.actor.email}）` : "已删除账号或系统"}</td>
              <td>{auditTargetTypeLabel(log.targetType)}{log.targetId ? ` / ${log.targetId}` : ""}</td>
              <td><code>{log.requestId}</code></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
