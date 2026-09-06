import Link from "next/link";
import { ArrowRight, BookOpen, CheckCheck, FileText, Plus, Target } from "lucide-react";
import { getStudentAnalytics } from "@/lib/analytics-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell, StatCard } from "@/components/page-shell";
const phaseName = { DIAGNOSIS: "认知诊断", SOCRATIC: "知识建构", FEYNMAN: "费曼阐释", REPORTING: "评估生成中", COMPLETED: "已完成", ABANDONED: "已结束" } as const;

export default async function DashboardPage() {
  const user = await requirePageUser(["STUDENT"]);
  const data = await getStudentAnalytics(user.id);
  const ongoing = data.recentSessions.find((session) => !["COMPLETED", "ABANDONED"].includes(session.phase));
  const completed = data.recentSessions.find((session) => session.phase === "COMPLETED");
  return <PageShell title="学习总览" description="研习进程与形成性评估" actions={<Link className="button" href="/learn/new"><Plus size={17} aria-hidden="true" />开始自主学习</Link>}>
    <section className="stat-grid" aria-label="学习概览"><StatCard label="累计研习" value={data.totalSessions} note="已建立的学习会话" /><StatCard label="已完成研习" value={data.completedSessions} note="已形成评估报告" /><StatCard label="形成性评估均分" value={data.averageScore ?? "--"} note="基于已完成报告" /><StatCard label="待巩固要点" value={data.openGaps} note="尚待验证的知识缺口" /></section>
    <div className="overview-columns">
      <section className="recent-learning"><div className="section-toolbar"><h2>研习记录</h2><Link href="/history">全部档案<ArrowRight size={15} aria-hidden="true" /></Link></div>
        {data.recentSessions.length ? <div className="data-list session-list"><div className="list-heading"><span>主题与学习目标</span><span>当前阶段</span></div>{data.recentSessions.map((session) => <Link key={session.id} className="data-row" href={session.phase === "COMPLETED" ? `/report/${session.id}` : `/session/${session.id}`}><span className="record-symbol" data-complete={session.phase === "COMPLETED"}>{session.phase === "COMPLETED" ? <CheckCheck size={20} aria-hidden="true" /> : <BookOpen size={20} aria-hidden="true" />}</span><span className="data-row-detail"><strong>{session.topic}</strong><small>{session.objective}</small></span><span className="badge" data-status={session.phase}>{phaseName[session.phase]}</span><ArrowRight className="row-arrow" size={16} aria-hidden="true" /></Link>)}</div> : <EmptyState title="尚无研习记录" description="自主研习与课程任务将在此汇集。" />}
      </section>
      <aside className="study-agenda"><h2>学习安排</h2><div className="agenda-item"><span className="agenda-label"><BookOpen size={16} aria-hidden="true" />当前研习</span>{ongoing ? <><h3>{ongoing.topic}</h3><p>{phaseName[ongoing.phase]}</p><Link href={`/session/${ongoing.id}`}>继续研习<ArrowRight size={15} aria-hidden="true" /></Link></> : <><h3>开启新的学习主题</h3><Link href="/learn/new">创建学习任务<ArrowRight size={15} aria-hidden="true" /></Link></>}</div><div className="agenda-item"><span className="agenda-label"><FileText size={16} aria-hidden="true" />学习反馈</span>{completed ? <><h3>{completed.topic}</h3><Link href={`/report/${completed.id}`}>查看评估报告<ArrowRight size={15} aria-hidden="true" /></Link></> : <p>暂无已完成的评估报告</p>}</div><div className="agenda-item"><span className="agenda-label"><Target size={16} aria-hidden="true" />课程任务</span><Link href="/assignments">查看教师发布任务<ArrowRight size={15} aria-hidden="true" /></Link></div></aside>
    </div>
  </PageShell>;
}
