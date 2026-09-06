import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { getAIProvider } from "../ai";
import { getServerEnv } from "../env";
import { withAIRequestProtection } from "../request-limits";
import { readSession } from "../session-data-service";
import { serializePayload } from "../serializers";
import { nextV12Transition, nextAfterReportSaved, recordStageTransition, confirmV12Goal, resumeV12State, finishV12Resume } from "../state-machine";
import { knowledgeRuntimeSchema } from "./runtime-schemas";
import { resolveRuntimeManifest } from "./releases";
import { aggregateDiagnosticLevel, applyV12Assessment, constructionReady, diagnosticFinished, mergeCaseExposureHistory, recordV12Action, selectV12Action } from "./v12-engine";
import { buildV12Report } from "./v12-report";
import { knowledgeContextBudget } from "./context-budget";

const asJson = (value: object): Prisma.InputJsonValue => structuredClone(value) as Prisma.InputJsonValue;
const dimensionKeyMap = { conceptCompleteness: "CONCEPT_COMPLETENESS", logicCompleteness: "LOGIC_COMPLETENESS", expressionClarity: "EXPRESSION_CLARITY", exampleAbility: "EXAMPLE_ABILITY", transferAbility: "TRANSFER_ABILITY" } as const;

export async function submitV12Turn(sessionId: string, text: string, clientRequestId: string, explanation = false, hint = false) {
  const session = await readSession(sessionId);
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  const duplicate = await prisma.message.findUnique({ where: { clientRequestId } });
  if (duplicate) {
    if (duplicate.sessionId !== sessionId) throw new AppError("CONFLICT", "请求标识已被其他会话使用。", 409);
    return { ...serializePayload(session), duplicate: true };
  }
  const env = getServerEnv();
  if (session.messages.length + 2 > env.MAX_MESSAGES_PER_SESSION || text.length > env.MAX_USER_MESSAGE_LENGTH) throw new AppError("CONFLICT", "本次提交超过会话容量限制。", 409);
  if (explanation ? session.phase !== "FEYNMAN" : !["DIAGNOSIS", "SOCRATIC"].includes(session.phase)) throw new AppError("CONFLICT", "当前阶段不接受此类回答。", 409);
  let runtime = knowledgeRuntimeSchema.parse(session.knowledgeRuntime);
  const manifest = await resolveRuntimeManifest(runtime.versions);
  if (!runtime.v12 || !manifest.v12) throw new Error("Expected v1.2 runtime and release");
  if (runtime.v12.pedagogicalStage === "GOAL_PRESENTATION") throw new AppError("CONFLICT", "请先确认研习目标。", 409);
  if (!runtime.v12.resumeVerification && Object.keys(runtime.v12.assessments).length > 0 && Date.now() - session.updatedAt.getTime() >= 30 * 60_000) throw new AppError("CONFLICT", "请先完成恢复核验。", 409);
  if (hint && runtime.v12.resumeVerification) throw new AppError("CONFLICT", "恢复核验需要独立作答。", 409);
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  let assistantMessage: string;
  let phase = session.phase;
  let turns = session.socraticTurns;
  let questionType: typeof session.messages[number]["questionType"] = null;
  let built: ReturnType<typeof buildV12Report> | null = null;
  let selectCaseInTransaction = false;
  if (hint) {
    const action = selectV12Action(manifest, runtime, now, true);
    if (!action) throw new AppError("CONFLICT", "当前提示已用完，请先尝试回答。", 409);
    runtime = recordV12Action(runtime, action, now);
    assistantMessage = action.assistantMessage;
    questionType = "SCAFFOLDED_HINT";
  } else {
    const target = manifest.knowledgeUnits.find((u) => u.id === runtime.currentTargetId);
    const assessment = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().assessLearningTurn({
      userId: session.userId, sessionId, requestId: clientRequestId,
      message: { id: messageId, content: text },
      lockedContext: { phase: session.phase, stage: runtime.v12!.pedagogicalStage, targetId: runtime.currentTargetId, questionId: runtime.currentQuestionId, caseId: runtime.v12!.currentCaseId, action: "ASSESS_EVIDENCE", hintLevel: runtime.hintLevels[runtime.currentTargetId!] ?? 0, releaseId: manifest.release.id, questionText: session.messages.filter((m) => m.role === "ASSISTANT").at(-1)?.content, caseContext: manifest.cases.find((c) => c.id === runtime.v12!.currentCaseId)?.studentText },
      knowledgeUnits: manifest.knowledgeUnits.filter((u) => u.id === target?.id || target?.prerequisites.includes(u.id)).slice(0, knowledgeContextBudget.knowledgeUnits).map(({ id, content }) => ({ id, content })),
      evidenceDefinitions: manifest.v12!.evidenceDefinitions, aliases: manifest.v12!.aliases,
    }));
    try { runtime = applyV12Assessment(manifest, runtime, assessment, { id: messageId, content: text }, now); }
    catch { throw new AppError("AI_INVALID_OUTPUT", "证据引用未通过校验，请重试。", 502, true); }
    const s = runtime.v12!;
    const resume = s.resumeVerification;
    if (resume) {
      runtime.v12 = finishV12Resume(session, s, now, s.observations.filter((o) => o.ref.messageId === messageId).map((o) => o.ref));
      if (s.lastResult === "NEED_VERIFY") {
        assistantMessage = "当前证据尚不足以恢复进度。请换一个具体情境，独立解释该概念的适用条件与因果联系。";
      } else {
        runtime.currentQuestionId = resume.questionId; runtime.currentTargetId = resume.targetId;
        runtime.v12.currentGroupId = resume.groupId; runtime.v12.currentCaseId = resume.caseId;
        assistantMessage = `${s.lastResult === "PASS" ? "恢复核验已完成。" : "恢复核验发现新的证据缺口，已记录为待巩固目标。"}\n\n${resume.assistantMessage}`;
      }
    } else {
    const transition = nextV12Transition(session, { stage: s.pedagogicalStage, diagnosisFinished: diagnosticFinished(runtime), constructionReady: constructionReady(s), transferPassed: s.transferPassed, majorError: Object.values(s.misconceptionStates).some((c) => ["CONFIRMED", "UNRESOLVED"].includes(c.status)), verificationRequired: s.lastResult === "NEED_VERIFY" });
    if (s.pedagogicalStage === "DIAGNOSIS" && transition.phase !== "DIAGNOSIS") s.diagnosticLevel = aggregateDiagnosticLevel(s);
    if (transition.reasonCode) s.stageTransitions = recordStageTransition(s, transition.stage, transition.reasonCode, now, s.observations.filter((o) => o.ref.messageId === messageId).map((o) => o.ref)).stageTransitions;
    s.pedagogicalStage = transition.stage;
    s.experienceLimitReached ||= transition.experienceLimitReached;
    phase = transition.phase; turns = transition.socraticTurns;
    runtime.pedagogicalStage = phase === "DIAGNOSIS" ? "DIAGNOSIS" : phase === "SOCRATIC" ? s.pedagogicalStage === "CASE_TRANSFER" ? "CASE_TRANSFER" : "SOCRATIC" : phase === "REPORTING" ? "REPORT" : "FEYNMAN";
    if (phase === "REPORTING") {
      built = buildV12Report(manifest, runtime, [...session.messages, { id: messageId, role: "USER", content: text }]);
      phase = nextAfterReportSaved({ ...session, phase: "REPORTING", socraticTurns: turns }).phase;
      s.activityType = "FORMATIVE_REPORT";
      assistantMessage = "本次学习反馈已生成。";
    } else if (phase === "FEYNMAN") {
      if (s.pedagogicalStage === "REFLECTION") {
        s.reflectionTargetId = Object.values(s.misconceptionStates).find((c) => c.status !== "RESOLVED")?.claimId ?? runtime.currentTargetId;
        s.reflectionTargetId = manifest.v12.errors[s.reflectionTargetId!]?.targetId ?? s.reflectionTargetId;
        s.activityType = "REFLECTION_REVISION";
        const label = manifest.knowledgeUnits.find((u) => u.id === s.reflectionTargetId)?.title;
        assistantMessage = `${s.experienceLimitReached ? "本次练习已达到轮数上限，未完成的验证会保留。\n\n" : ""}${label ? `围绕${label}，` : "围绕刚才解释中最不确定的一处，"}你能补充关键因果联系并用自己的话修订解释吗？`;
      } else {
        s.activityType = "INDEPENDENT_EXPLANATION";
        assistantMessage = "请面向初学者自主解释系统性风险是什么、为什么传播，并用一个有机制的例子串联你的解释。";
      }
      runtime.currentQuestionId = null;
      s.currentCaseId = null;
    } else {
      const action = selectV12Action(manifest, runtime, now);
      if (!action) throw new AppError("CONFLICT", "当前版本缺少可用的验证题，请联系教师。", 409);
      selectCaseInTransaction = Boolean(action.caseId);
      if (!selectCaseInTransaction) runtime = recordV12Action(runtime, action, now);
      assistantMessage = action.assistantMessage;
      questionType = action.questionType;
    }
    }
  }
  knowledgeRuntimeSchema.parse(runtime);
  try {
    await prisma.$transaction(async (tx) => {
      if (selectCaseInTransaction) {
        // Serialize case reservation across this student's concurrent sessions.
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext(${session.userId}))`;
        const history = await tx.learningSession.findMany({ where: { userId: session.userId, id: { not: sessionId }, knowledgeRuntime: { not: Prisma.DbNull } }, select: { knowledgeRuntime: true } });
        const parsed = history.flatMap((row) => { const result = knowledgeRuntimeSchema.safeParse(row.knowledgeRuntime); return result.success ? [result.data] : []; });
        runtime = mergeCaseExposureHistory(runtime, parsed);
        const action = selectV12Action(manifest, runtime, now);
        if (!action?.caseId) throw new AppError("CONFLICT", "当前版本缺少可用案例。", 409);
        runtime = recordV12Action(runtime, action, now);
        knowledgeRuntimeSchema.parse(runtime);
        assistantMessage = action.assistantMessage;
        questionType = action.questionType;
      }
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: session.phase }, data: { phase, socraticTurns: turns, knowledgeRuntime: asJson(runtime), version: { increment: 1 }, ...(built ? { completedAt: new Date() } : {}) } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话已变化，请刷新后重试。", 409, true);
      if (!hint) await tx.message.create({ data: { id: messageId, sessionId, role: "USER", phase: session.phase, content: text, clientRequestId } });
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase, content: assistantMessage, questionType, ...(hint ? { clientRequestId } : {}) } });
      if (built) {
        const { report, evidenceLinks } = built;
        const created = await tx.learningReport.create({ data: {
          sessionId, summary: report.summary, overallScore: report.overallScore, overallLevel: report.overallLevel, disclaimer: report.disclaimer,
          sessionVersions: asJson(runtime.versions), evidenceLinks: asJson(evidenceLinks), evidenceAudit: asJson(runtime.v12!),
          dimensions: { create: Object.entries(report.dimensions).map(([key, dimension]) => ({ key: dimensionKeyMap[key as keyof typeof dimensionKeyMap], ...dimension })) },
          strengths: { create: report.strengths.map((strength, position) => ({ ...strength, position })) }, gaps: { create: report.gaps },
          nextSteps: { create: report.nextSteps.map((description, position) => ({ description, position })) },
        } });
        if (session.assignmentId) await tx.assignmentStudent.updateMany({ where: { assignmentId: session.assignmentId, studentId: session.userId }, data: { progress: "COMPLETED", completedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: session.userId, action: "REPORT_CREATED", targetType: "LearningReport", targetId: created.id, requestId: clientRequestId } });
      }
    }, { isolationLevel: "ReadCommitted", timeout: 20_000 });
  } catch (error) {
    const duplicate = await prisma.message.findUnique({ where: { clientRequestId } });
    if (duplicate?.sessionId === sessionId) return { ...serializePayload((await readSession(sessionId))!), duplicate: true };
    throw error;
  }
  return { ...serializePayload((await readSession(sessionId))!), duplicate: false };
}

export async function submitV12SessionEvent(sessionId: string, input: { action: "GOAL_CONFIRMED" | "SESSION_RESUMED"; clientRequestId: string }) {
  const session = await readSession(sessionId);
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  const duplicate = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (duplicate) {
    if (duplicate.sessionId !== sessionId) throw new AppError("CONFLICT", "请求标识已被使用。", 409);
    return { ...serializePayload(session), duplicate: true };
  }
  let runtime = knowledgeRuntimeSchema.parse(session.knowledgeRuntime);
  if (!runtime.v12) throw new AppError("CONFLICT", "当前会话不支持该操作。", 409);
  const manifest = await resolveRuntimeManifest(runtime.versions);
  const now = new Date().toISOString();
  let content: string;
  if (input.action === "GOAL_CONFIRMED") {
    if (runtime.v12.pedagogicalStage !== "GOAL_PRESENTATION") throw new AppError("CONFLICT", "研习目标已确认。", 409);
    runtime.v12 = confirmV12Goal(session, runtime.v12, now);
    const action = selectV12Action(manifest, runtime, now)!;
    runtime = recordV12Action(runtime, action, now); content = action.assistantMessage;
  } else {
    if (!["DIAGNOSIS", "SOCRATIC", "FEYNMAN"].includes(session.phase) || runtime.v12.pedagogicalStage === "GOAL_PRESENTATION" || runtime.v12.resumeVerification) throw new AppError("CONFLICT", "当前阶段不能重复发起恢复核验。", 409);
    const targetId = Object.keys(runtime.v12.unitStates).find((id) => runtime.v12!.unitStates[id].status === "MASTERED" && manifest.v12!.unitRules[id]) ?? runtime.currentTargetId ?? "C_SR_001";
    runtime.v12 = resumeV12State(session, runtime.v12, { stage: runtime.v12.pedagogicalStage, activityType: runtime.v12.activityType, questionId: runtime.currentQuestionId, targetId: runtime.currentTargetId, groupId: runtime.v12.currentGroupId, caseId: runtime.v12.currentCaseId, assistantMessage: session.messages.filter((m) => m.role === "ASSISTANT").at(-1)?.content ?? "", requestedAt: now }, now);
    runtime.currentTargetId = targetId; runtime.currentQuestionId = `RESUME_${session.version}`;
    const title = manifest.knowledgeUnits.find((u) => u.id === targetId)?.title ?? "因果链与条件变化";
    content = `恢复核验：请以一个新的具体情境，说明“${title}”的适用条件及其因果联系。`;
  }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version }, data: { knowledgeRuntime: asJson(runtime), version: { increment: 1 } } });
    if (changed.count !== 1) throw new AppError("CONFLICT", "会话已变化，请刷新。", 409);
    await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: session.phase, content, clientRequestId: input.clientRequestId } });
  });
  return { ...serializePayload((await readSession(sessionId))!), duplicate: false };
}
