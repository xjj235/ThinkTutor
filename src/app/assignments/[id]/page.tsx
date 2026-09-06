import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { StartAssignmentButton } from "@/components/start-assignment-button";
import { getAssignment } from "@/lib/courses-service";
import { prisma } from "@/lib/db";
import { assignmentProgressLabels, assignmentStatusLabels } from "@/lib/display-labels";
import { requirePageUser } from "@/lib/page-auth";

const formatDateTime = (value: Date | null) =>
  value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeStyle: "short" }).format(value) : "未设置";

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser(["STUDENT"]);
  const { id } = await params;
  let item;
  try {
    item = await getAssignment(user, id);
  } catch {
    notFound();
  }
  const progress = await prisma.assignmentStudent.findUnique({
    where: { assignmentId_studentId: { assignmentId: item.id, studentId: user.id } },
    select: { progress: true, startedAt: true, completedAt: true },
  });
  const sessions = await prisma.learningSession.findMany({
    where: { userId: user.id, assignmentId: item.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, phase: true, updatedAt: true, report: { select: { overallScore: true } } },
  });
  const activeSession = sessions.find((session) => session.phase !== "COMPLETED" && session.phase !== "ABANDONED");
  const latestCompleted = sessions.find((session) => session.phase === "COMPLETED");
  const usedAttempts = sessions.filter((session) => session.phase === "COMPLETED" || session.phase === "ABANDONED").length;
  const now = new Date();
  const notOpen = item.openAt ? item.openAt > now : false;
  const overdue = item.dueAt ? item.dueAt < now : false;
  const attemptsUsedUp = usedAttempts >= item.maxAttempts && !activeSession;
  const canStart = !activeSession && !notOpen && !overdue && !attemptsUsedUp;

  return (
    <PageShell title={item.title} description={`${item.course.title} · ${item.classroom.name}`}>
      <article className="card">
        <h2>学习要求</h2>
        <p>{item.instructions}</p>
        <dl>
          <dt>任务状态</dt>
          <dd>{assignmentStatusLabels[item.status]}</dd>
          <dt>学习进度</dt>
          <dd>{progress ? assignmentProgressLabels[progress.progress] : "未分配"}</dd>
          <dt>学习水平</dt>
          <dd>{item.learnerLevel}</dd>
          <dt>章节</dt>
          <dd>{item.chapter?.title ?? "未限定"}</dd>
          <dt>学习目标</dt>
          <dd>{item.learningGoal?.title ?? "按任务要求学习"}</dd>
          <dt>开放时间</dt>
          <dd>{formatDateTime(item.openAt)}</dd>
          <dt>截止时间</dt>
          <dd>{formatDateTime(item.dueAt)}</dd>
          <dt>尝试次数</dt>
          <dd>{usedAttempts} / {item.maxAttempts}</dd>
        </dl>
        {activeSession ? (
          <Link className="button" href={`/session/${activeSession.id}`}>继续学习</Link>
        ) : canStart ? (
          <StartAssignmentButton assignmentId={item.id} />
        ) : latestCompleted?.report ? (
          <Link className="button button-secondary" href={`/report/${latestCompleted.id}`}>查看最近报告 {latestCompleted.report.overallScore} 分</Link>
        ) : (
          <p className="form-hint" role="status">
            {notOpen ? "该任务尚未开放。" : overdue ? "该任务已截止。" : "该任务的尝试次数已用完。"}
          </p>
        )}
      </article>
    </PageShell>
  );
}
