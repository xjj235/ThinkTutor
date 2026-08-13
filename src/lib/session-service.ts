import "server-only";

import { Prisma, type QuestionType } from "@prisma/client";
import {
  answerInputSchema,
  createSessionInputSchema,
  type CreateSessionInput,
  enterFeynmanInputSchema,
  feynmanInputSchema,
  hintInputSchema,
  learnerStateSchema,
  type LearningReportDTO,
  MAX_MESSAGES_PER_SESSION,
  messageMetadataSchema,
  type MessageMetadata,
  retryInputSchema,
  type SessionPayload,
} from "./contracts";
import { getAIProvider } from "./ai";
import { buildLearningContext } from "./ai/context-builder";
import { prisma } from "./db";
import { AppError } from "./errors";
import { getServerEnv } from "./env";
import { withAIRequestProtection } from "./request-limits";
import { readSession } from "./session-data-service";
import { finalizeReportDraft } from "./scoring";
import { reportRelations, serializePayload, serializeReport, sessionRelations } from "./serializers";
import {
  canEnterFeynmanVoluntarily,
  canRequestHint,
  canRetrySession,
  canSubmitAnswer,
  canSubmitFeynman,
  enterFeynmanVoluntarily,
  isLowInformationAnswer,
  nextAfterDiagnosisAnswer,
  nextAfterFeynman,
  nextAfterReportSaved,
  nextAfterSocraticAnswer,
  type FeynmanReadinessEvidence,
} from "./state-machine";

const asJson = (value: object): Prisma.InputJsonValue => structuredClone(value) as Prisma.InputJsonValue;

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function metadataFromCoach(coach: {
  learnerState: MessageMetadata["learnerState"];
  nextAction: MessageMetadata["nextAction"];
  transitionReason: string;
}): MessageMetadata {
  return { learnerState: coach.learnerState, nextAction: coach.nextAction, transitionReason: coach.transitionReason };
}

function toAiMessages(messages: Array<{ role: "USER" | "ASSISTANT" | "SYSTEM"; phase: "DIAGNOSIS" | "SOCRATIC" | "FEYNMAN" | "REPORTING" | "COMPLETED" | "ABANDONED"; content: string; questionType: QuestionType | null }>) {
  return messages.map(({ role, phase, content, questionType }) => ({ role, phase, content, questionType }));
}

async function getRequiredSessionRecord(id: string) {
  const session = await readSession(id);
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  return session;
}

async function findDuplicate(sessionId: string, clientRequestId: string): Promise<boolean> {
  const message = await prisma.message.findUnique({ where: { clientRequestId } });
  if (!message) return false;
  if (message.sessionId !== sessionId) throw new AppError("CONFLICT", "clientRequestId 已被其他会话使用。", 409);
  return true;
}

function recentUnknownStreak(messages: Array<{ role: string; content: string }>): number {
  let streak = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "USER") continue;
    if (!isLowInformationAnswer(message.content)) break;
    streak += 1;
  }
  return Math.min(streak, 4);
}

function assertMessageCapacity(currentCount: number, additionalMessages: number): void {
  const limit = Math.min(MAX_MESSAGES_PER_SESSION, getServerEnv().MAX_MESSAGES_PER_SESSION);
  if (currentCount + additionalMessages > limit) throw new AppError("CONFLICT", "本会话消息数量已达上限。", 409);
}

function buildTaskInput(session: { courseId: string | null; chapterId: string | null; learningGoalId: string | null; assignmentId: string | null; course: string | null; chapter: string | null; topic: string; objective: string; learnerLevel: string; referenceText: string | null }): CreateSessionInput {
  return createSessionInputSchema.parse({
    courseId: session.courseId ?? undefined,
    chapterId: session.chapterId ?? undefined,
    learningGoalId: session.learningGoalId ?? undefined,
    assignmentId: session.assignmentId ?? undefined,
    course: session.course ?? undefined,
    chapter: session.chapter ?? undefined,
    topic: session.topic,
    objective: session.objective,
    learnerLevel: session.learnerLevel,
    referenceText: session.referenceText ?? undefined,
  });
}

function readinessEvidence(session: Awaited<ReturnType<typeof getRequiredSessionRecord>>, learnerState = session.learnerState): FeynmanReadinessEvidence {
  const answeredQuestionTypes = session.messages
    .filter((message) => message.role === "ASSISTANT" && message.phase === "SOCRATIC" && message.questionType)
    .map((message) => message.questionType as QuestionType);
  return {
    answeredQuestionTypes,
    learnerState: learnerState === null ? null : learnerStateSchema.parse(learnerState),
  };
}

function feynmanContent(instruction: { assistantMessage: string; requirements: string[] }): string {
  return `${instruction.assistantMessage}\n\n请满足以下要求：\n${instruction.requirements.map((item) => `- ${item}`).join("\n")}`;
}

async function resolveTaskForUser(userId: string, input: CreateSessionInput): Promise<{ task: CreateSessionInput; source: "SELF_DIRECTED" | "ASSIGNMENT"; assignmentId?: string }> {
  if (!input.assignmentId) {
    if (!input.courseId) {
      if (input.chapterId || input.learningGoalId) throw new AppError("VALIDATION_ERROR", "选择章节或学习目标前必须先选择课程。", 400);
      return { task: input, source: "SELF_DIRECTED" };
    }

    const course = await prisma.course.findFirst({
      where: {
        id: input.courseId,
        status: "PUBLISHED",
        classrooms: { some: { status: "ACTIVE", enrollments: { some: { userId, status: "ACTIVE" } } } },
      },
      select: { id: true, title: true },
    });
    if (!course) throw new AppError("FORBIDDEN", "你无权使用该课程创建自主学习任务。", 403);

    const chapter = input.chapterId
      ? await prisma.chapter.findFirst({ where: { id: input.chapterId, courseId: course.id }, select: { id: true, title: true } })
      : null;
    if (input.chapterId && !chapter) throw new AppError("VALIDATION_ERROR", "所选章节不属于该课程。", 400);

    const goal = input.learningGoalId
      ? await prisma.learningGoal.findFirst({ where: { id: input.learningGoalId, courseId: course.id }, select: { id: true, chapterId: true, title: true, objective: true } })
      : null;
    if (input.learningGoalId && !goal) throw new AppError("VALIDATION_ERROR", "所选学习目标不属于该课程。", 400);
    if (goal?.chapterId && chapter && goal.chapterId !== chapter.id) throw new AppError("VALIDATION_ERROR", "所选学习目标不属于该章节。", 400);

    const goalChapter = !chapter && goal?.chapterId
      ? await prisma.chapter.findUnique({ where: { id: goal.chapterId }, select: { id: true, title: true } })
      : null;
    const resolvedChapter = chapter ?? goalChapter;
    return {
      source: "SELF_DIRECTED",
      task: createSessionInputSchema.parse({
        ...input,
        courseId: course.id,
        course: course.title,
        chapterId: resolvedChapter?.id,
        chapter: resolvedChapter?.title,
        learningGoalId: goal?.id,
        topic: goal?.title ?? input.topic,
        objective: goal?.objective ?? input.objective,
      }),
    };
  }
  const assigned = await prisma.assignmentStudent.findUnique({
    where: { assignmentId_studentId: { assignmentId: input.assignmentId, studentId: userId } },
    include: { assignment: { include: { course: true, chapter: true, learningGoal: true } } },
  });
  if (!assigned || assigned.assignment.status !== "PUBLISHED") throw new AppError("FORBIDDEN", "该学习任务未分配给当前用户。", 403);
  const assignment = assigned.assignment;
  return {
    source: "ASSIGNMENT",
    assignmentId: assignment.id,
    task: createSessionInputSchema.parse({
      assignmentId: assignment.id,
      courseId: assignment.courseId,
      chapterId: assignment.chapterId ?? undefined,
      learningGoalId: assignment.learningGoalId ?? undefined,
      course: assignment.course.title,
      chapter: assignment.chapter?.title,
      topic: assignment.learningGoal?.title ?? assignment.title,
      objective: assignment.learningGoal?.objective ?? assignment.instructions,
      learnerLevel: assignment.learnerLevel,
    }),
  };
}

export async function getSessionPayload(id: string): Promise<SessionPayload> {
  return serializePayload(await getRequiredSessionRecord(id));
}

export async function createLearningSession(userId: string, input: CreateSessionInput, options?: { parentSessionId?: string; sourceGapId?: string }): Promise<SessionPayload> {
  const resolved = await resolveTaskForUser(userId, createSessionInputSchema.parse(input));
  if ((resolved.task.referenceText?.length ?? 0) > getServerEnv().MAX_REFERENCE_TEXT_LENGTH) throw new AppError("VALIDATION_ERROR", "参考材料超过允许长度。", 400);
  const requestId = `ai_${crypto.randomUUID()}`;
  const diagnostic = await withAIRequestProtection(userId, `create:${requestId}`, () => getAIProvider().createDiagnosticQuestion({ task: resolved.task, userId, requestId }));
  const created = await prisma.$transaction(async (tx) => {
    const session = await tx.learningSession.create({
      data: {
        userId,
        courseId: resolved.task.courseId,
        chapterId: resolved.task.chapterId,
        learningGoalId: resolved.task.learningGoalId,
        assignmentId: resolved.assignmentId,
        source: options?.parentSessionId ? "RETRY" : resolved.source,
        course: resolved.task.course,
        chapter: resolved.task.chapter,
        topic: resolved.task.topic,
        objective: resolved.task.objective,
        learnerLevel: resolved.task.learnerLevel,
        referenceText: resolved.task.referenceText,
        parentSessionId: options?.parentSessionId,
        sourceGapId: options?.sourceGapId,
        learnerState: asJson(diagnostic.learnerState),
        messages: { create: { role: "ASSISTANT", phase: "DIAGNOSIS", content: diagnostic.assistantMessage, questionType: diagnostic.questionType, metadata: asJson(metadataFromCoach(diagnostic)) } },
      },
      include: sessionRelations,
    });
    await tx.auditLog.create({ data: { actorId: userId, action: "SESSION_CREATED", targetType: "LearningSession", targetId: session.id, requestId } });
    return session;
  });
  return serializePayload(created);
}

export async function submitLearningAnswer(sessionId: string, input: { answer: string; clientRequestId: string }): Promise<SessionPayload & { duplicate: boolean }> {
  answerInputSchema.parse(input);
  if (input.answer.length > getServerEnv().MAX_USER_MESSAGE_LENGTH) throw new AppError("VALIDATION_ERROR", "回答超过允许长度。", 400);
  if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
  const session = await getRequiredSessionRecord(sessionId);
  if (!canSubmitAnswer(session)) throw new AppError("CONFLICT", "当前阶段不能提交普通回答。", 409);
  assertMessageCapacity(session.messages.length, 2);
  const task = buildTaskInput(session);
  const context = await buildLearningContext({ courseId: session.courseId, chapterId: session.chapterId, topic: session.topic, objective: session.objective, latestAnswer: input.answer, contextSummary: session.contextSummary, messages: toAiMessages(session.messages) });
  const coach = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createCoachTurn({
    task,
    userId: session.userId,
    sessionId,
    requestId: input.clientRequestId,
    phase: session.phase === "DIAGNOSIS" ? "SOCRATIC" : session.phase,
    socraticTurns: session.socraticTurns,
    maxTurns: session.maxTurns,
    unknownStreak: isLowInformationAnswer(input.answer) ? recentUnknownStreak(session.messages) + 1 : 0,
    learnerState: session.learnerState === null ? null : learnerStateSchema.parse(session.learnerState),
    messages: [...context.recentMessages, { role: "USER", phase: session.phase, content: input.answer, questionType: null }],
    latestAnswer: input.answer,
    contextSummary: context.contextSummary,
    retrievedContext: context.retrievedContext,
  }));
  const evidence = readinessEvidence(session, coach.learnerState);
  const transition = session.phase === "DIAGNOSIS" ? nextAfterDiagnosisAnswer(session) : nextAfterSocraticAnswer(session, coach.nextAction, evidence);
  const enteringFeynman = transition.phase === "FEYNMAN";
  const instruction = enteringFeynman
    ? await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createFeynmanInstruction({ task, learnerState: coach.learnerState, userId: session.userId, sessionId, requestId: `${input.clientRequestId}:feynman` }))
    : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
      if (duplicate) return duplicate.sessionId === sessionId ? "duplicate" as const : Promise.reject(new AppError("CONFLICT", "clientRequestId 已被其他会话使用。", 409));
      const changed = await tx.learningSession.updateMany({
        where: { id: sessionId, version: session.version, phase: session.phase, socraticTurns: session.socraticTurns },
        data: { phase: transition.phase, socraticTurns: transition.socraticTurns, learnerState: asJson(coach.learnerState), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { sessionId, role: "USER", phase: session.phase, content: input.answer, clientRequestId: input.clientRequestId } });
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: transition.phase, content: instruction ? feynmanContent(instruction) : coach.assistantMessage, questionType: instruction ? null : coach.questionType, metadata: asJson(metadataFromCoach(coach)) } });
      return "created" as const;
    }, { isolationLevel: "ReadCommitted" });
    if (result === "duplicate") return { ...(await getSessionPayload(sessionId)), duplicate: true };
  } catch (error) {
    if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
    if (isWriteConflict(error)) throw new AppError("CONFLICT", "会话正在更新，请重试。", 409, true);
    throw error;
  }
  return { ...(await getSessionPayload(sessionId)), duplicate: false };
}

export async function requestHint(sessionId: string, input: { clientRequestId: string }): Promise<SessionPayload & { duplicate: boolean }> {
  hintInputSchema.parse(input);
  if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
  const session = await getRequiredSessionRecord(sessionId);
  if (!canRequestHint(session)) throw new AppError("CONFLICT", "当前阶段不能申请提示。", 409);
  assertMessageCapacity(session.messages.length, 1);
  const context = await buildLearningContext({ courseId: session.courseId, chapterId: session.chapterId, topic: session.topic, objective: session.objective, contextSummary: session.contextSummary, messages: toAiMessages(session.messages) });
  const hint = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createCoachTurn({
    task: buildTaskInput(session), userId: session.userId, sessionId, requestId: input.clientRequestId, phase: session.phase,
    socraticTurns: session.socraticTurns, maxTurns: session.maxTurns, unknownStreak: Math.max(1, recentUnknownStreak(session.messages)),
    learnerState: session.learnerState === null ? null : learnerStateSchema.parse(session.learnerState), messages: context.recentMessages, contextSummary: context.contextSummary, retrievedContext: context.retrievedContext, isHintRequest: true,
  }));
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: session.phase }, data: { learnerState: asJson(hint.learnerState), version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: session.phase, content: hint.assistantMessage, questionType: "SCAFFOLDED_HINT", clientRequestId: input.clientRequestId, metadata: asJson(metadataFromCoach(hint)) } });
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
    if (isWriteConflict(error)) throw new AppError("CONFLICT", "会话正在更新，请重试。", 409, true);
    throw error;
  }
  return { ...(await getSessionPayload(sessionId)), duplicate: false };
}

export async function enterLearningFeynman(sessionId: string, input: { clientRequestId: string }): Promise<SessionPayload & { duplicate: boolean }> {
  enterFeynmanInputSchema.parse(input);
  if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
  const session = await getRequiredSessionRecord(sessionId);
  const evidence = readinessEvidence(session);
  if (!canEnterFeynmanVoluntarily(session, evidence)) throw new AppError("CONFLICT", "尚未形成足够的概念、因果与证据追问，暂不能进入费曼讲解。", 409);
  const transition = enterFeynmanVoluntarily(session, evidence);
  const instruction = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createFeynmanInstruction({ task: buildTaskInput(session), learnerState: evidence.learnerState, userId: session.userId, sessionId, requestId: input.clientRequestId }));
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: session.phase }, data: { phase: transition.phase, version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: "FEYNMAN", content: feynmanContent(instruction), clientRequestId: input.clientRequestId } });
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
    if (isWriteConflict(error)) throw new AppError("CONFLICT", "会话正在更新，请重试。", 409, true);
    throw error;
  }
  return { ...(await getSessionPayload(sessionId)), duplicate: false };
}

const dimensionKeyMap = {
  conceptCompleteness: "CONCEPT_COMPLETENESS",
  logicCompleteness: "LOGIC_COMPLETENESS",
  expressionClarity: "EXPRESSION_CLARITY",
  exampleAbility: "EXAMPLE_ABILITY",
  transferAbility: "TRANSFER_ABILITY",
} as const;

export async function submitFeynmanExplanation(sessionId: string, input: { explanation: string; clientRequestId: string }): Promise<{ payload: SessionPayload; report: LearningReportDTO; duplicate: boolean }> {
  feynmanInputSchema.parse(input);
  if (await findDuplicate(sessionId, input.clientRequestId)) {
    const payload = await getSessionPayload(sessionId);
    if (!payload.report) throw new AppError("NOT_FOUND", "学习报告不存在。", 404);
    return { payload, report: payload.report, duplicate: true };
  }
  const session = await getRequiredSessionRecord(sessionId);
  if (!canSubmitFeynman(session)) throw new AppError("CONFLICT", "当前阶段不能提交费曼讲解。", 409);
  assertMessageCapacity(session.messages.length, 1);
  const reporting = nextAfterFeynman(session);
  const draft = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createLearningReport({
    task: buildTaskInput(session), userId: session.userId, sessionId, requestId: input.clientRequestId,
    messages: [...toAiMessages(session.messages), { role: "USER", phase: "FEYNMAN", content: input.explanation, questionType: null }],
    feynmanExplanation: input.explanation,
  }));
  const report = finalizeReportDraft(draft);
  const completed = nextAfterReportSaved({ ...session, phase: reporting.phase });
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: "FEYNMAN" }, data: { phase: "REPORTING", version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { sessionId, role: "USER", phase: "FEYNMAN", content: input.explanation, clientRequestId: input.clientRequestId } });
      const createdReport = await tx.learningReport.create({
        data: {
          sessionId, summary: report.summary, overallScore: report.overallScore, overallLevel: report.overallLevel, disclaimer: report.disclaimer,
          dimensions: { create: Object.entries(report.dimensions).map(([key, dimension]) => ({ key: dimensionKeyMap[key as keyof typeof dimensionKeyMap], ...dimension })) },
          strengths: { create: report.strengths.map((title, position) => ({ title, evidence: "来自本次报告中已确认的对话表现。", position })) },
          gaps: { create: report.gaps },
          nextSteps: { create: report.nextSteps.map((description, position) => ({ description, position })) },
        },
      });
      await tx.learningSession.update({ where: { id: sessionId }, data: { phase: completed.phase, completedAt: new Date(), version: { increment: 1 } } });
      if (session.assignmentId) await tx.assignmentStudent.updateMany({ where: { assignmentId: session.assignmentId, studentId: session.userId }, data: { progress: "COMPLETED", completedAt: new Date() } });
      await tx.auditLog.createMany({ data: [
        { actorId: session.userId, action: "REPORT_CREATED", targetType: "LearningReport", targetId: createdReport.id, requestId: input.clientRequestId },
        { actorId: session.userId, action: "SESSION_COMPLETED", targetType: "LearningSession", targetId: sessionId, requestId: input.clientRequestId },
      ] });
      return createdReport;
    }, { isolationLevel: "ReadCommitted", timeout: 20_000 });
  } catch (error) {
    if (isUniqueConstraintError(error) && await findDuplicate(sessionId, input.clientRequestId)) {
      const payload = await getSessionPayload(sessionId);
      if (!payload.report) throw error;
      return { payload, report: payload.report, duplicate: true };
    }
    throw error;
  }
  const payload = await getSessionPayload(sessionId);
  if (!payload.report) throw new AppError("INTERNAL_ERROR", "学习报告生成失败。", 500);
  return { payload, report: payload.report, duplicate: false };
}

export async function getReportPayload(sessionId: string) {
  const report = await prisma.learningReport.findUnique({ where: { sessionId }, include: reportRelations });
  if (!report) throw new AppError("NOT_FOUND", "学习报告不存在。", 404);
  const session = await getRequiredSessionRecord(sessionId);
  return { session: serializePayload(session).session, report: serializeReport(report) };
}

export async function createRetrySession(sessionId: string, input: { clientRequestId: string }): Promise<SessionPayload & { duplicate: boolean }> {
  retryInputSchema.parse(input);
  const existingMarker = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
  if (existingMarker) {
    if (existingMarker.sessionId !== sessionId || existingMarker.metadata === null) throw new AppError("CONFLICT", "clientRequestId 已被使用。", 409);
    const retryId = messageMetadataSchema.parse(existingMarker.metadata).retrySessionId;
    if (!retryId) throw new AppError("CONFLICT", "clientRequestId 已被其他操作使用。", 409);
    return { ...(await getSessionPayload(retryId)), duplicate: true };
  }
  const session = await getRequiredSessionRecord(sessionId);
  if (!canRetrySession(session) || !session.report) throw new AppError("CONFLICT", "只有已完成且包含报告的会话可以再练。", 409);
  const gap = await prisma.learningGap.findFirst({ where: { reportId: session.report.id, status: "OPEN" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }] });
  if (!gap) throw new AppError("CONFLICT", "没有待修复的学习漏洞。", 409);
  const task = buildTaskInput(session);
  const retryTask = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createRetryTask({ task, gap: { title: gap.title, evidence: gap.evidence, repairTask: gap.repairTask, priority: gap.priority }, userId: session.userId, sessionId, requestId: input.clientRequestId }));
  const childTask = createSessionInputSchema.parse({ ...task, topic: retryTask.topic, objective: retryTask.objective, assignmentId: undefined });
  const diagnostic = await withAIRequestProtection(session.userId, `${sessionId}:retry`, () => getAIProvider().createDiagnosticQuestion({ task: childTask, userId: session.userId, requestId: `${input.clientRequestId}:diagnostic` }));
  try {
    const childId = await prisma.$transaction(async (tx) => {
      const child = await tx.learningSession.create({
        data: {
          userId: session.userId, courseId: session.courseId, chapterId: session.chapterId, learningGoalId: session.learningGoalId,
          source: "RETRY", course: childTask.course, chapter: childTask.chapter, topic: childTask.topic, objective: childTask.objective,
          learnerLevel: childTask.learnerLevel, referenceText: childTask.referenceText, parentSessionId: sessionId, sourceGapId: gap.id,
          learnerState: asJson(diagnostic.learnerState),
          messages: { create: { role: "ASSISTANT", phase: "DIAGNOSIS", content: diagnostic.assistantMessage, questionType: diagnostic.questionType, metadata: asJson(metadataFromCoach(diagnostic)) } },
        },
      });
      await tx.learningGap.update({ where: { id: gap.id }, data: { status: "IN_PROGRESS" } });
      await tx.message.create({ data: { sessionId, role: "SYSTEM", phase: "COMPLETED", content: "已创建针对最高优先级漏洞的再练会话。", clientRequestId: input.clientRequestId, metadata: asJson({ retrySessionId: child.id }) } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "SESSION_CREATED", targetType: "LearningSession", targetId: child.id, requestId: input.clientRequestId, metadata: { parentSessionId: sessionId } } });
      return child.id;
    }, { isolationLevel: "ReadCommitted" });
    return { ...(await getSessionPayload(childId)), duplicate: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const marker = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
    const retryId = marker?.metadata ? messageMetadataSchema.parse(marker.metadata).retrySessionId : undefined;
    if (!retryId) throw error;
    return { ...(await getSessionPayload(retryId)), duplicate: true };
  }
}
