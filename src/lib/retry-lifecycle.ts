import "server-only";

import type { LearningSession, Prisma } from "@prisma/client";
import { getAIProvider } from "./ai";
import { prisma } from "./db";
import { AppError } from "./errors";
import { withAIRequestProtection } from "./request-limits";
import { resolveRuntimeManifest } from "./knowledge/releases";
import type { KnowledgeRuntime } from "./knowledge/runtime-schemas";
import { finalizeRetryReview, retryReviewInputSchema, type RetryReview, type RetryReviewInput } from "./retry-review";

type RetrySession = Pick<LearningSession, "id" | "userId" | "parentSessionId" | "sourceGapId">;

export async function reviewCompletedRetry(
  session: RetrySession,
  input: Pick<RetryReviewInput, "messages" | "report">,
  requestId: string,
  runtime?: KnowledgeRuntime | null,
): Promise<RetryReview | null> {
  if (!session.sourceGapId) return null;
  const gap = await prisma.learningGap.findFirst({
    where: { id: session.sourceGapId, report: { sessionId: session.parentSessionId ?? "", session: { userId: session.userId } } },
  });
  if (!gap || gap.status !== "IN_PROGRESS") throw new AppError("CONFLICT", "原巩固要点已变化，请刷新后重试。", 409, true);

  let resolutionBlockedReason: string | undefined;
  if (runtime?.flags.includes("FLAG_NEED_VERIFY")) resolutionBlockedReason = "本次仍有待核验证据，请继续独立作答后再判断是否解决。";
  if (runtime?.v12) {
    const manifest = await resolveRuntimeManifest(runtime.versions);
    const definition = manifest.v12;
    const claimId = definition && [...Object.keys(definition.errors), ...Object.keys(definition.gaps)].find((id) => gap.evidence.includes(`（${id}）`));
    if (claimId && definition) {
      const targetId = definition.errors[claimId]?.targetId ?? definition.gaps[claimId];
      const claim = runtime.v12.finalClaims.find((item) => item.id === claimId);
      if ((claim && claim.status !== "RESOLVED") || runtime.v12.unitStates[targetId]?.status !== "MASTERED") {
        resolutionBlockedReason = "原要点对应的知识证据尚未通过本次结构化核验。";
      }
    }
    if (gap.title === "独立迁移证据不足" && !runtime.v12.transferPassed) resolutionBlockedReason = "本次尚未完成独立案例迁移核验。";
  }
  const reviewInput = retryReviewInputSchema.parse({
    sourceGap: { id: gap.id, title: gap.title, evidence: gap.evidence, repairTask: gap.repairTask },
    ...input,
    ...(resolutionBlockedReason ? { resolutionBlockedReason } : {}),
  });
  const candidate = await withAIRequestProtection(session.userId, session.id, () => getAIProvider().assessGapRepair({
    ...reviewInput, userId: session.userId, sessionId: session.id, requestId: `${requestId}:gap-review`,
  }));
  try {
    return finalizeRetryReview(candidate, reviewInput, new Date().toISOString());
  } catch {
    throw new AppError("AI_INVALID_OUTPUT", "巩固复核的证据未通过校验，请重试。", 502, true);
  }
}

export async function saveRetryGapStatus(tx: Prisma.TransactionClient, session: RetrySession, review: RetryReview | null): Promise<void> {
  if (!review) return;
  if (review.sourceGapId !== session.sourceGapId) throw new AppError("CONFLICT", "巩固复核与原要点不匹配。", 409);
  const changed = await tx.learningGap.updateMany({
    where: { id: review.sourceGapId, status: "IN_PROGRESS", report: { sessionId: session.parentSessionId ?? "", session: { userId: session.userId } } },
    data: { status: review.status, resolvedAt: review.status === "RESOLVED" ? new Date(review.reviewedAt) : null },
  });
  if (changed.count !== 1) throw new AppError("CONFLICT", "原巩固要点已变化，请刷新后重试。", 409, true);
}
