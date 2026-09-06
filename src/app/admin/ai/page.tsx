import { listAIUsage } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { aiOperationLabel, aiUsageStatusLabels } from "@/lib/display-labels";

export default async function AdminAIPage() {
  await requirePageUser(["ADMIN"]);
  const rows = await listAIUsage(100);

  return (
    <PageShell
      title="AI 使用"
      description="日志不包含 API Key、完整提示词或学生敏感原文。"
    >
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">最近 100 条 AI 使用记录</caption>
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
                  <td>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(row.createdAt)}</td>
                  <td>{row.model}</td>
                  <td>{aiOperationLabel(row.operation)}</td>
                  <td>{aiUsageStatusLabels[row.status]}</td>
                  <td>{(row.promptTokens ?? 0) + (row.completionTokens ?? 0)}</td>
                  <td>{row.latencyMs} ms</td>
                  <td>{row.errorCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="暂无 AI 使用记录" description="系统产生模型调用后，使用状态会显示在这里。" />
      )}
    </PageShell>
  );
}
