import { listMaterialJobs } from "@/lib/admin-service";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell, EmptyState } from "@/components/page-shell";
import { MaterialActions } from "@/components/material-actions";
export default async function AdminMaterialsPage(){await requirePageUser(["ADMIN"]);const jobs=await listMaterialJobs(100);return <PageShell title="材料处理任务" description="管理员可在网页查看处理状态，并对失败任务重新入队；材料所有权仍由服务端校验。">{jobs.length?<div className="data-list">{jobs.map(job=><div className="data-row material-row" key={job.id}><span><strong>{job.title}</strong><small>{job.originalName} · {job.failureMessage??"暂无错误信息"}</small></span><div><span className="badge">{job.status} · 重试 {job.retryCount}</span><MaterialActions id={job.id} title={job.title} status={job.status} allowDelete={false}/></div></div>)}</div>:<EmptyState title="没有异常任务" description="当前没有排队或失败的材料处理记录。"/>}</PageShell>}
