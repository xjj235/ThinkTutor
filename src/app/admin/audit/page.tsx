import { listAuditLogs } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";

export default async function AdminAuditPage() {
  await requirePageUser(["ADMIN"]);
  const logs = await listAuditLogs(100);
  return (
    <PageShell title="审计日志" description="仅展示关键操作元数据，不保存密码、密钥或学习正文。">
      {logs.length === 0 ? <div className="empty-state">暂无审计事件。</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>目标</th><th>请求 ID</th></tr></thead>
            <tbody>{logs.map((log) => <tr key={log.id}>
              <td>{log.createdAt.toLocaleString("zh-CN")}</td>
              <td>{log.action}</td>
              <td>{log.actor ? `${log.actor.name}（${log.actor.email}）` : "已删除账号或系统"}</td>
              <td>{log.targetType}{log.targetId ? ` / ${log.targetId}` : ""}</td>
              <td><code>{log.requestId}</code></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
