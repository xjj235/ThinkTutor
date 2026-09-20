import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { getAIProvider } from "../ai";
import { getServerEnv } from "../env";
import { withAIRequestProtection } from "../request-limits";
import { readSession } from "../session-data-service";
import { assertExpectedSessionVersion } from "../session-version";
import { serializePayload } from "../serializers";
import { nextV12Transition, nextAfterReportSaved, recordStageTransition, confirmV12Goal, resumeV12State, finishV12Resume } from "../state-machine";
import { knowledgeRuntimeSchema } from "./runtime-schemas";
import { resolveRuntimeManifest } from "./releases";
import { aggregateDiagnosticLevel, applyV12Assessment, constructionReady, diagnosticFinished, mergeCaseExposureHistory, recordV12Action, selectV12Action } from "./v12-engine";
import { buildAssessmentRules } from "./assessment-context";
import { buildV12Report } from "./v12-report";
import { knowledgeContextBudget } from "./context-budget";
import { buildV12TurnFeedback } from "./turn-feedback";
import { tutorResponseSchema } from "./v12-schema";
import { diagnoseCoaching, recordCoaching } from "./coaching";
import { selectCoaching } from "./coaching-service";
import { reviewCompletedRetry, saveRetryGapStatus } from "../retry-lifecycle";
import type { KnowledgeAction } from "./orchestrator";
import type { CoachingProfile, CoachingKind } from "./coaching-schema";

const asJson = (value: object): Prisma.InputJsonValue => structuredClone(value) as Prisma.InputJsonValue;
const nextMessageCreatedAt = (messages: ReadonlyArray<{ createdAt: Date }>): Date =>
  new Date(messages.reduce((next, message) => Math.max(next, message.createdAt.getTime() + 1), Date.now()));
const dimensionKeyMap = { conceptCompleteness: "CONCEPT_COMPLETENESS", logicCompleteness: "LOGIC_COMPLETENESS", expressionClarity: "EXPRESSION_CLARITY", exampleAbility: "EXAMPLE_ABILITY", transferAbility: "TRANSFER_ABILITY" } as const;
const feynmanQuestion = "请面向初学者自主解释系统性风险是什么、为什么传播，并用一个有机制的例子串联你的解释。";
const reflectionQuestion = (label?: string) => `${label ? `围绕${label}，` : "围绕刚才解释中最不确定的一处，"}你能补充关键因果联系并用自己的话修订解释吗？`;
const resumeQuestion = (label?: string) => `恢复核验：请以一个新的具体情境，说明“${label ?? "因果链与条件变化"}”的适用条件及其因果联系。`;

export async function submitV12Turn(sessionId: string, text: string, clientRequestId: string, explanation = false, hint = false, expectedVersion?: number) {
  const session = await readSession(sessionId);
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  const duplicate = await prisma.message.findUnique({ where: { clientRequestId } });
  if (duplicate) {
    if (duplicate.sessionId !== sessionId) throw new AppError("CONFLICT", "请求标识已被其他会话使用。", 409);
    return { ...serializePayload(session), duplicate: true };
  }
  assertExpectedSessionVersion(session, expectedVersion);
  const env = getServerEnv();
  if (session.messages.length + 2 > env.MAX_MESSAGES_PER_SESSION) throw new AppError("CONFLICT", "本次提交超过会话容量限制。", 409);
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
  let pendingCase: KnowledgeAction | null = null;
  let profile: CoachingProfile | undefined;
  const wasResume = Boolean(runtime.v12.resumeVerification);
  let feedback = "";
  if (hint) {
    const action = selectV12Action(manifest, runtime, now, true);
    if (!action) throw new AppError("CONFLICT", "当前提示已用完，请先尝试回答。", 409);
    runtime = recordV12Action(runtime, action, now);
    assistantMessage = action.assistantMessage;
    questionType = "SCAFFOLDED_HINT";
  } else {
    const answeredRuntime = runtime;
    const target = manifest.knowledgeUnits.find((u) => u.id === runtime.currentTargetId);
    let questionText = manifest.diagnosticQuestions.find((q) => q.id === runtime.currentQuestionId)?.questionText
      ?? manifest.socraticQuestions.find((q) => q.id === runtime.currentQuestionId)?.questionText
      ?? manifest.v12.cases[runtime.v12.currentCaseId ?? ""]?.studentQuestions
      ?? target?.learningRequirement;
    // Feedback contains untrusted student quotations and must not become the locked question.
    if (runtime.v12.resumeVerification) questionText = resumeQuestion(target?.title);
    else if (runtime.v12.pedagogicalStage === "FEYNMAN_OUTPUT") questionText = feynmanQuestion;
    else if (runtime.v12.pedagogicalStage === "REFLECTION") questionText = reflectionQuestion(manifest.knowledgeUnits.find((u) => u.id === runtime.v12!.reflectionTargetId)?.title);
    else if (runtime.currentQuestionId?.startsWith("CASE_VERIFY_")) questionText = "哪一条具体事实支持你的因果判断，条件改变后这一判断是否仍然成立？";
    if (runtime.v12.coachingPrompt?.questionId === runtime.currentQuestionId && runtime.v12.coachingPrompt?.stage === runtime.v12.pedagogicalStage) questionText = runtime.v12.coachingPrompt.text;
    const assessment = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().assessLearningTurn({
      userId: session.userId, sessionId, requestId: clientRequestId,
      message: { id: messageId, content: text },
      lockedContext: { phase: session.phase, stage: runtime.v12!.pedagogicalStage, targetId: runtime.currentTargetId, questionId: runtime.currentQuestionId, caseId: runtime.v12!.currentCaseId, action: "ASSESS_EVIDENCE", hintLevel: runtime.hintLevels[runtime.currentTargetId!] ?? 0, releaseId: manifest.release.id, questionText, caseContext: manifest.cases.find((c) => c.id === runtime.v12!.currentCaseId)?.studentText },
      knowledgeUnits: manifest.knowledgeUnits.filter((u) => u.id === target?.id || target?.prerequisites.includes(u.id)).slice(0, knowledgeContextBudget.knowledgeUnits).map(({ id, content }) => ({ id, content })),
      evidenceDefinitions: manifest.v12!.evidenceDefinitions, aliases: manifest.v12!.aliases,
      evaluationRules: buildAssessmentRules(manifest, runtime),
      candidateTargets: { misconceptionIds: Object.keys(manifest.v12!.errors), gapIds: Object.keys(manifest.v12!.gaps) },
    }));
    try { runtime = applyV12Assessment(manifest, runtime, assessment, { id: messageId, content: text }, now); }
    catch { throw new AppError("AI_INVALID_OUTPUT", "证据引用未通过校验，请重试。", 502, true); }
    profile = diagnoseCoaching(manifest, runtime, session.learnerLevel);
    feedback = buildV12TurnFeedback(manifest, answeredRuntime, runtime, messageId, profile.ruleDecision?.supportedGap);
    const s = runtime.v12!;
    const resume = s.resumeVerification;
    if (resume) {
      runtime.v12 = finishV12Resume(session, s, now, s.observations.filter((o) => o.ref.messageId === messageId).map((o) => o.ref));
      if (s.lastResult === "NEED_VERIFY") {
        assistantMessage = "当前证据尚不足以恢复进度。请换一个具体情境，独立解释该概念的适用条件与因果联系。";
      } else {
        runtime.currentQuestionId = resume.questionId; runtime.currentTargetId = resume.targetId;
        runtime.v12.currentGroupId = resume.groupId; runtime.v12.currentCaseId = resume.caseId;
        runtime.v12.coachingPrompt = resume.coachingPrompt ?? null;
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
      assistantMessage = built.report.summary;
    } else if (phase === "FEYNMAN") {
      if (s.pedagogicalStage === "REFLECTION") {
        s.reflectionTargetId = Object.values(s.misconceptionStates).find((c) => c.status !== "RESOLVED")?.claimId ?? runtime.currentTargetId;
        s.reflectionTargetId = manifest.v12.errors[s.reflectionTargetId!]?.targetId ?? s.reflectionTargetId;
        s.activityType = "REFLECTION_REVISION";
        const label = manifest.knowledgeUnits.find((u) => u.id === s.reflectionTargetId)?.title;
        assistantMessage = `${s.experienceLimitReached ? "本次练习已达到轮数上限，未完成的验证会保留。\n\n" : ""}${reflectionQuestion(label)}`;
      } else {
        s.activityType = "INDEPENDENT_EXPLANATION";
        assistantMessage = `${s.experienceLimitReached ? "本次追问已达到轮数上限，未完成的验证会保留。请先完成独立讲解，再进行反思。\n\n" : ""}${feynmanQuestion}`;
      }
      runtime.currentQuestionId = null;
      s.currentCaseId = null;
    } else {
      const action = selectV12Action(manifest, runtime, now);
      if (!action) throw new AppError("CONFLICT", "当前版本缺少可用的验证题，请联系教师。", 409);
      selectCaseInTransaction = Boolean(action.caseId);
      pendingCase = selectCaseInTransaction ? action : null;
      if (!selectCaseInTransaction) runtime = recordV12Action(runtime, action, now);
      assistantMessage = action.assistantMessage;
      questionType = action.questionType;
    }
    }
  }
  const kind: CoachingKind = wasResume ? "RESUME" : hint || questionType === "SCAFFOLDED_HINT" ? "HINT" : built ? "REPORT" : runtime.v12!.pedagogicalStage === "FEYNMAN_OUTPUT" ? "FEYNMAN" : runtime.v12!.pedagogicalStage === "REFLECTION" ? "REFLECTION" : pendingCase ? "CASE" : runtime.v12!.pedagogicalStage === "DIAGNOSIS" ? "DIAGNOSIS" : "QUESTION";
  // Select only a case-independent frame before the transaction; the case itself
  // remains reserved under the existing per-student database lock.
  const presentationRuntime = pendingCase ? recordV12Action(runtime, pendingCase, now) : runtime;
  const recentTurns = session.messages.filter((m) => m.role === "USER" || m.role === "ASSISTANT").slice(-6).map((m) => ({ role: m.role as "USER" | "ASSISTANT", content: m.content.slice(0, 2000) }));
  const coaching = await selectCoaching(manifest, presentationRuntime, { kind, content: assistantMessage, learnerLevel: session.learnerLevel, studentContent: hint ? session.messages.filter((m) => m.role === "USER").at(-1)?.content : text, profile, recentTurns }, { userId: session.userId, sessionId, requestId: `${clientRequestId}:teaching` }, sessionId);
  knowledgeRuntimeSchema.parse(runtime);
  const independentExplanationId = runtime.v12!.finalFeynmanMessageId;
  const retryReview = built ? await reviewCompletedRetry(session, {
    messages: [...session.messages, { id: messageId, role: "USER", phase: session.phase, content: text }]
      .filter((message) => message.role === "USER")
      .map(({ id, phase: messagePhase, content }) => ({ id, role: "USER" as const, phase: messagePhase, content, isIndependentExplanation: id === independentExplanationId })),
    report: { summary: built.report.summary, gaps: built.report.gaps },
  }, clientRequestId, runtime) : null;
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
      const presented = recordCoaching(runtime, coaching.prepared, coaching.decision, { requestId: `${clientRequestId}:teaching`, now }, assistantMessage);
      runtime = presented.runtime;
      questionType = presented.questionType ?? questionType;
      assistantMessage = presented.assistantMessage;
      if (built) built.report.summary = assistantMessage;
      const response = tutorResponseSchema.parse({ assistantMessage: feedback && !built ? `${feedback}\n\n${assistantMessage}` : assistantMessage });
      knowledgeRuntimeSchema.parse(runtime);
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: session.phase }, data: { phase, socraticTurns: turns, knowledgeRuntime: asJson(runtime), version: { increment: 1 }, ...(built ? { completedAt: new Date() } : {}) } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话已变化，请刷新后重试。", 409, true);
      const messageCreatedAt = nextMessageCreatedAt(session.messages);
      if (!hint) await tx.message.create({ data: { id: messageId, sessionId, role: "USER", phase: session.phase, content: text, clientRequestId, createdAt: messageCreatedAt } });
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase, content: response.assistantMessage, questionType, ...(hint ? { clientRequestId } : {}), createdAt: hint ? messageCreatedAt : new Date(messageCreatedAt.getTime() + 1) } });
      if (built) {
        const { report, evidenceLinks } = built;
        const created = await tx.learningReport.create({ data: {
          sessionId, summary: report.summary, overallScore: report.overallScore, overallLevel: report.overallLevel, disclaimer: report.disclaimer,
          sessionVersions: asJson(runtime.versions), evidenceLinks: asJson(evidenceLinks), evidenceAudit: asJson(runtime.v12!),
          ...(retryReview ? { retryReview: asJson(retryReview) } : {}),
          dimensions: { create: Object.entries(report.dimensions).map(([key, dimension]) => ({ key: dimensionKeyMap[key as keyof typeof dimensionKeyMap], ...dimension })) },
          strengths: { create: report.strengths.map((strength, position) => ({ ...strength, position })) }, gaps: { create: report.gaps },
          nextSteps: { create: report.nextSteps.map((description, position) => ({ description, position })) },
        } });
        await saveRetryGapStatus(tx, session, retryReview);
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

export async function submitV12SessionEvent(sessionId: string, input: { action: "GOAL_CONFIRMED" | "SESSION_RESUMED"; clientRequestId: string; expectedVersion?: number }) {
  try {
    return await saveV12SessionEvent(sessionId, input);
  } catch (error) {
    const accepted = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (accepted?.sessionId === sessionId) return { ...serializePayload((await readSession(sessionId))!), duplicate: true };
    throw error;
  }
}

async function saveV12SessionEvent(sessionId: string, input: { action: "GOAL_CONFIRMED" | "SESSION_RESUMED"; clientRequestId: string; expectedVersion?: number }) {
  const session = await readSession(sessionId);
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  const duplicate = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (duplicate) {
    if (duplicate.sessionId !== sessionId) throw new AppError("CONFLICT", "请求标识已被使用。", 409);
    return { ...serializePayload(session), duplicate: true };
  }
  assertExpectedSessionVersion(session, input.expectedVersion);
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
    runtime.v12 = resumeV12State(session, runtime.v12, { stage: runtime.v12.pedagogicalStage, activityType: runtime.v12.activityType, questionId: runtime.currentQuestionId, targetId: runtime.currentTargetId, groupId: runtime.v12.currentGroupId, caseId: runtime.v12.currentCaseId, assistantMessage: session.messages.filter((m) => m.role === "ASSISTANT").at(-1)?.content ?? "", requestedAt: now, coachingPrompt: runtime.v12.coachingPrompt }, now);
    runtime.currentTargetId = targetId; runtime.currentQuestionId = `RESUME_${session.version}`;
    content = resumeQuestion(manifest.knowledgeUnits.find((u) => u.id === targetId)?.title);
  }
  const coaching = await selectCoaching(manifest, runtime, { kind: input.action === "GOAL_CONFIRMED" ? "DIAGNOSIS" : "RESUME", content, learnerLevel: session.learnerLevel }, { userId: session.userId, sessionId, requestId: `${input.clientRequestId}:teaching` }, sessionId);
  const presented = recordCoaching(runtime, coaching.prepared, coaching.decision, { requestId: `${input.clientRequestId}:teaching`, now });
  runtime = knowledgeRuntimeSchema.parse(presented.runtime);
  content = tutorResponseSchema.parse({ assistantMessage: presented.assistantMessage }).assistantMessage;
  await prisma.$transaction(async (tx) => {
    const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version }, data: { knowledgeRuntime: asJson(runtime), version: { increment: 1 } } });
    if (changed.count !== 1) throw new AppError("CONFLICT", "会话已变化，请刷新。", 409);
    await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: session.phase, content, clientRequestId: input.clientRequestId, createdAt: nextMessageCreatedAt(session.messages) } });
  });
  return { ...serializePayload((await readSession(sessionId))!), duplicate: false };
}
