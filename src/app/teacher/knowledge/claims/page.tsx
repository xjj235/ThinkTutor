import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";
import { KnowledgeReviewForm } from "@/components/knowledge-review-forms";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
export default async function ClaimReviewPage() {
  const user = await requirePageUser(["TEACHER", "ADMIN"]);
  const sessions = await prisma.learningSession.findMany({ where: { ...(user.role === "ADMIN" ? {} : { assignment: { createdById: user.id } }), knowledgeRuntime: { not: Prisma.DbNull } }, orderBy: { updatedAt: "desc" }, take: 50, include: { student: { select: { name: true } } } });
  const rows = sessions.flatMap((session) => {
    const parsed = knowledgeRuntimeSchema.safeParse(session.knowledgeRuntime);
    return parsed.success && parsed.data.v12 ? Object.values({ ...parsed.data.v12.misconceptionStates, ...parsed.data.v12.gapStates, ...parsed.data.v12.flagStates }).filter((c) => c.status === "CANDIDATE" || c.status === "CONFIRMED").map((claim) => ({ session, claim })) : [];
  });
  return <PageShell title="学生判断复核" actions={<Link href="/teacher/knowledge">知识版本审核</Link>}>
    {!rows.length ? <p>当前没有待复核判断。</p> : null}
    {rows.map(({ session, claim }) => <section key={`${session.id}-${claim.claimId}`} className="space-y-3 border-b py-4">
      <h2 className="break-words">{session.student.name}：{claim.claimId}</h2>
      <p>模型置信度：{claim.modelAssessmentConfidence}；独立核验：{claim.verificationCount}；冲突：{claim.contradictionCount}；系统置信度：{claim.systemConfidence}</p>
      {claim.evidenceRefs.map((r, i) => <blockquote className="break-words text-sm leading-6" key={`${r.messageId}-${i}`}>{r.extractedText}</blockquote>)}
      <KnowledgeReviewForm kind="CLAIM" sessionId={session.id} claimId={claim.claimId} version={session.version} />
    </section>)}
  </PageShell>;
}
