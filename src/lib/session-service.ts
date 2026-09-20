import { resolveKnowledgeSelection, isStudentKnowledgeTaskTopic } from "./knowledge/student-catalog";
import "server-only";

import { Prisma, type QuestionType } from "@prisma/client";
import {
  answerInputSchema,
  createSessionInputSchema,
  type CreateSessionInput,
  DEFAULT_MAX_TURNS,
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
import { assertExpectedSessionVersion } from "./session-version";
import { finalizeReportDraft } from "./scoring";
import { reviewCompletedRetry, saveRetryGapStatus } from "./retry-lifecycle";
import { createVersionSnapshot, findKnowledgeManifest, resolveRuntimeManifest } from "./knowledge/releases";
import { knowledgeRuntimeSchema } from "./knowledge/runtime-schemas";
import { presentV12Goal } from "./state-machine";
import { initialKnowledgeRuntime, recordKnowledgeAction, recordKnowledgeAnswer, selectKnowledgeAction } from "./knowledge/orchestrator";
import { linkReportEvidence } from "./knowledge/report-evidence";
import { submitV12Turn } from "./knowledge/v12-session-service";
import { selectCoaching } from "./knowledge/coaching-service";
import { recordCoaching } from "./knowledge/coaching";
import type { SourcedDiagnosticQuestion } from "./ai/types";
import { reportRelations, serializePayload, serializeReport, sessionRelations } from "./serializers";
import {
  answeredSocraticQuestionTypes,
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

function initialCuratedDiagnostic(): SourcedDiagnosticQuestion {
  return { assistantMessage: "等待确认研习目标。", questionType: "CONCEPT_CLARIFICATION", learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] }, nextAction: "ASK_QUESTION", transitionReason: "由知识库约束初始诊断范围。", knowledgePolicy: "COURSE_KNOWLEDGE_FIRST", webSources: [] };
}

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
  knowledgePolicy?: MessageMetadata["knowledgePolicy"];
  webSources?: MessageMetadata["webSources"];
}): MessageMetadata {
  return {
    learnerState: coach.learnerState,
    nextAction: coach.nextAction,
    transitionReason: coach.transitionReason,
    ...(coach.knowledgePolicy ? { knowledgePolicy: coach.knowledgePolicy } : {}),
    ...(coach.webSources?.length ? { webSources: coach.webSources } : {}),
  };
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

// Database timestamps can tie inside a transaction; preserve the causal message order.
function nextMessageCreatedAt(messages: ReadonlyArray<{ createdAt: Date }>): Date {
  return new Date(messages.reduce((next, message) => Math.max(next, message.createdAt.getTime() + 1), Date.now()));
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

function nextHintLevel(messages: Array<{ role: string; content: string; questionType: QuestionType | null }>): number {
  let consecutiveHints = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "USER") break;
    if (message.role === "ASSISTANT" && message.questionType === "SCAFFOLDED_HINT") consecutiveHints += 1;
  }
  return Math.min(3, Math.max(1, recentUnknownStreak(messages)) + consecutiveHints);
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

function readinessEvidence(session: Awaited<ReturnType<typeof getRequiredSessionRecord>>, learnerState = session.learnerState, pendingAnswer?: string): FeynmanReadinessEvidence {
  const messages = pendingAnswer === undefined ? session.messages : [
    ...session.messages, { role: "USER", phase: session.phase, content: pendingAnswer, questionType: null },
  ];
  return {
    answeredQuestionTypes: answeredSocraticQuestionTypes(messages),
    learnerState: learnerState === null ? null : learnerStateSchema.parse(learnerState),
  };
}

function feynmanContent(instruction: { assistantMessage: string; requirements: string[] }): string {
  return `${instruction.assistantMessage}\n\n请满足以下要求：\n${instruction.requirements.map((item) => `- ${item}`).join("\n")}`;
}

async function findExistingCreateRequest(userId: string, clientRequestId: string): Promise<SessionPayload | null> {
  const session = await prisma.learningSession.findUnique({
    where: { userId_clientRequestId: { userId, clientRequestId } },
    include: sessionRelations,
  });
  return session ? serializePayload(session) : null;
}

async function resolveTaskForUser(userId: string, input: CreateSessionInput, db: Prisma.TransactionClient = prisma): Promise<{ task: CreateSessionInput; source: "SELF_DIRECTED" | "ASSIGNMENT"; assignmentId?: string; existingSessionId?: string }> {
  if (input.knowledgeSelection) {
    if (input.assignmentId || input.courseId || input.chapterId || input.learningGoalId) {
      throw new AppError("VALIDATION_ERROR", "知识库自主研习不能同时绑定班级课程或作业，请选择一种学习方式。", 400);
    }
    const task = resolveKnowledgeSelection(input.knowledgeSelection);
    return { source: "SELF_DIRECTED", task: createSessionInputSchema.parse({ ...input, ...task, knowledgeSelection: undefined }) };
  }
  if (!input.assignmentId) {
    if (!input.courseId) {
      if (input.chapterId || input.learningGoalId) throw new AppError("VALIDATION_ERROR", "选择章节或学习目标前必须先选择课程。", 400);
      return { task: input, source: "SELF_DIRECTED" };
    }

    const course = await db.course.findFirst({
      where: {
        id: input.courseId,
        status: "PUBLISHED",
        classrooms: { some: { status: "ACTIVE", enrollments: { some: { userId, status: "ACTIVE" } } } },
      },
      select: { id: true, title: true },
    });
    if (!course) throw new AppError("FORBIDDEN", "你无权使用该课程创建自主学习任务。", 403);

    const chapter = input.chapterId
      ? await db.chapter.findFirst({ where: { id: input.chapterId, courseId: course.id }, select: { id: true, title: true } })
      : null;
    if (input.chapterId && !chapter) throw new AppError("VALIDATION_ERROR", "所选章节不属于该课程。", 400);

    const goal = input.learningGoalId
      ? await db.learningGoal.findFirst({ where: { id: input.learningGoalId, courseId: course.id }, select: { id: true, chapterId: true, title: true, objective: true } })
      : null;
    if (input.learningGoalId && !goal) throw new AppError("VALIDATION_ERROR", "所选学习目标不属于该课程。", 400);
    if (goal?.chapterId && chapter && goal.chapterId !== chapter.id) throw new AppError("VALIDATION_ERROR", "所选学习目标不属于该章节。", 400);

    const goalChapter = !chapter && goal?.chapterId
      ? await db.chapter.findUnique({ where: { id: goal.chapterId }, select: { id: true, title: true } })
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
  const assigned = await db.assignmentStudent.findUnique({
    where: { assignmentId_studentId: { assignmentId: input.assignmentId, studentId: userId } },
    include: { assignment: { include: { course: true, chapter: true, learningGoal: true } } },
  });
  if (!assigned || assigned.assignment.status !== "PUBLISHED") throw new AppError("FORBIDDEN", "该学习任务未分配给当前用户。", 403);
  const assignment = assigned.assignment;
  const enrollment = await db.enrollment.findFirst({ where: { userId, classroomId: assignment.classroomId, status: "ACTIVE", classroom: { status: "ACTIVE" } }, select: { id: true } });
  if (!enrollment) throw new AppError("FORBIDDEN", "你已不在该任务的有效班级中。", 403);
  const activeSession = await db.learningSession.findFirst({
    where: { userId, assignmentId: assignment.id, phase: { notIn: ["COMPLETED", "ABANDONED"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (activeSession) {
    return {
      source: "ASSIGNMENT",
      assignmentId: assignment.id,
      existingSessionId: activeSession.id,
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
  const now = new Date();
  if (assignment.openAt && assignment.openAt > now) throw new AppError("CONFLICT", "该学习任务尚未开放。", 409, true);
  if (assignment.dueAt && assignment.dueAt < now) throw new AppError("CONFLICT", "该学习任务已截止。", 409);
  const usedAttempts = await db.learningSession.count({
    where: { userId, assignmentId: assignment.id, phase: { in: ["COMPLETED", "ABANDONED"] } },
  });
  if (usedAttempts >= assignment.maxAttempts) throw new AppError("CONFLICT", "该学习任务的尝试次数已用完。", 409);
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

export async function createLearningSession(userId: string, input: CreateSessionInput, options?: { parentSessionId?: string; sourceGapId?: string; clientRequestId?: string }): Promise<SessionPayload> {
  if (options?.clientRequestId) {
    const existing = await findExistingCreateRequest(userId, options.clientRequestId);
    if (existing) return existing;
  }
  const resolved = await resolveTaskForUser(userId, createSessionInputSchema.parse(input));
  if (resolved.existingSessionId) return getSessionPayload(resolved.existingSessionId);
  try {
    if ((resolved.task.referenceText?.length ?? 0) > getServerEnv().MAX_REFERENCE_TEXT_LENGTH) throw new AppError("VALIDATION_ERROR", "参考材料超过允许长度。", 400);
    const requestId = options?.clientRequestId ?? `ai_${crypto.randomUUID()}`;
    const protectionKey = resolved.assignmentId ? `assignment-start:${userId}:${resolved.assignmentId}` : `create:${requestId}`;
    const manifest = await findKnowledgeManifest(resolved.task.topic, isStudentKnowledgeTaskTopic(resolved.task.topic) ? {} : resolved.task);
    let runtime = manifest ? initialKnowledgeRuntime(createVersionSnapshot(manifest)) : null;
    const context = await buildLearningContext({
      courseId: resolved.task.courseId,
      chapterId: resolved.task.chapterId,
      topic: resolved.task.topic,
      objective: resolved.task.objective,
      phase: "DIAGNOSIS",
      knowledgeRuntime: runtime,
      messages: [],
    });
    const diagnostic = runtime?.v12 && manifest ? initialCuratedDiagnostic() : await withAIRequestProtection(userId, protectionKey, () => getAIProvider().createDiagnosticQuestion({
      task: resolved.task,
      userId,
      requestId,
      retrievedContext: context.retrievedContext,
      knowledgePolicy: context.knowledgePolicy,
    }));
    if (runtime && manifest) {
      const question = manifest.diagnosticQuestions.find((item) => item.status === "published");
      if (!question) throw new AppError("CONFLICT", "当前知识版本没有可用诊断题。", 409);
      diagnostic.assistantMessage = question.questionText;
      diagnostic.knowledgePolicy = "COURSE_KNOWLEDGE_FIRST";
      diagnostic.webSources = [];
      runtime.currentQuestionId = question.id;
      runtime.currentTargetId = question.targetConcepts[0];
      runtime.usedQuestionIds.push(question.id);
      if (runtime.v12) {
        runtime.v12 = presentV12Goal(runtime.v12, new Date().toISOString());
        runtime.currentQuestionId = null; runtime.currentTargetId = null; runtime.usedQuestionIds = [];
        diagnostic.assistantMessage = `研习目标：${resolved.task.objective}\n\n预计用时：15–20分钟。`;
        const now = new Date().toISOString();
        const coaching = await selectCoaching(manifest, runtime, { kind: "GOAL", content: diagnostic.assistantMessage, learnerLevel: resolved.task.learnerLevel, studentContent: resolved.task.objective }, { userId, requestId: `${requestId}:teaching` }, protectionKey);
        const presented = recordCoaching(runtime, coaching.prepared, coaching.decision, { requestId: `${requestId}:teaching`, now });
        runtime = knowledgeRuntimeSchema.parse(presented.runtime);
        diagnostic.assistantMessage = presented.assistantMessage;
      }
    }
    const created = await prisma.$transaction(async (tx) => {
      if (resolved.assignmentId) {
        // Serialize starts for this assigned student, including other app workers.
        // AI work happens before the lock; recheck eligibility before committing.
        await tx.$queryRaw`SELECT "id" FROM "AssignmentStudent" WHERE "assignmentId" = ${resolved.assignmentId} AND "studentId" = ${userId} FOR UPDATE`;
        const current = await resolveTaskForUser(userId, createSessionInputSchema.parse(input), tx);
        if (current.existingSessionId) return tx.learningSession.findUniqueOrThrow({ where: { id: current.existingSessionId }, include: sessionRelations });
        if (JSON.stringify(current.task) !== JSON.stringify(resolved.task)) throw new AppError("CONFLICT", "学习任务内容已变化，请刷新后重新开始。", 409, true);
      }
      const session = await tx.learningSession.create({
        data: {
          userId,
          courseId: resolved.task.courseId,
          chapterId: resolved.task.chapterId,
          learningGoalId: resolved.task.learningGoalId,
          assignmentId: resolved.assignmentId,
          clientRequestId: options?.clientRequestId,
          source: options?.parentSessionId ? "RETRY" : resolved.source,
          course: resolved.task.course,
          chapter: resolved.task.chapter,
          topic: resolved.task.topic,
          objective: resolved.task.objective,
          learnerLevel: resolved.task.learnerLevel,
          referenceText: resolved.task.referenceText,
          parentSessionId: options?.parentSessionId,
          sourceGapId: options?.sourceGapId,
          maxTurns: DEFAULT_MAX_TURNS,
          learnerState: asJson(diagnostic.learnerState),
          ...(runtime ? { knowledgeRuntime: asJson(runtime) } : {}),
          messages: { create: { role: "ASSISTANT", phase: "DIAGNOSIS", content: diagnostic.assistantMessage, questionType: diagnostic.questionType, metadata: asJson(metadataFromCoach(diagnostic)) } },
        },
        include: sessionRelations,
      });
      if (resolved.assignmentId) {
        await tx.assignmentStudent.updateMany({
          where: { assignmentId: resolved.assignmentId, studentId: userId, progress: "NOT_STARTED" },
          data: { progress: "IN_PROGRESS", startedAt: new Date() },
        });
      }
      await tx.auditLog.create({ data: { actorId: userId, action: "SESSION_CREATED", targetType: "LearningSession", targetId: session.id, requestId } });
      return session;
    });
    return serializePayload(created);
  } catch (error) {
    if (options?.clientRequestId && isUniqueConstraintError(error)) {
      const existing = await findExistingCreateRequest(userId, options.clientRequestId);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function submitLearningAnswer(sessionId: string, input: { answer: string; clientRequestId: string; expectedVersion?: number }): Promise<SessionPayload & { duplicate: boolean }> {
  answerInputSchema.parse(input);
  if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
  const session = await getRequiredSessionRecord(sessionId);
  assertExpectedSessionVersion(session, input.expectedVersion);
  if (!canSubmitAnswer(session)) throw new AppError("CONFLICT", "当前阶段不能提交普通回答。", 409);
  if (session.knowledgeRuntime && knowledgeRuntimeSchema.parse(session.knowledgeRuntime).v12) return submitV12Turn(sessionId, input.answer, input.clientRequestId, false, false, input.expectedVersion);
  assertMessageCapacity(session.messages.length, 2);
  const task = buildTaskInput(session);
  const learnerState = session.learnerState === null ? null : learnerStateSchema.parse(session.learnerState);
  const runtime = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
  const manifest = runtime ? await resolveRuntimeManifest(runtime.versions) : undefined;
  const answeredRuntime = runtime ? recordKnowledgeAnswer(runtime) : null;
  const action = answeredRuntime && manifest ? selectKnowledgeAction(manifest, answeredRuntime, learnerState, session.socraticTurns) : null;
  if (runtime && !action) throw new AppError("CONFLICT", "当前知识版本没有可用的新题目，请新建学习任务。", 409);
  const context = await buildLearningContext({ courseId: session.courseId, chapterId: session.chapterId, topic: session.topic, objective: session.objective, latestAnswer: input.answer, contextSummary: session.contextSummary, phase: "SOCRATIC", learnerState, knowledgeRuntime: runtime, selectedAction: action, messages: toAiMessages(session.messages) });
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
    knowledgePolicy: context.knowledgePolicy,
    selectedAction: action ?? undefined,
  }));
  if (action) {
    coach.assistantMessage = action.assistantMessage;
    coach.questionType = action.questionType;
    coach.nextAction = "ASK_QUESTION";
    coach.knowledgePolicy = "COURSE_KNOWLEDGE_FIRST";
    coach.webSources = [];
  }
  const evidence = readinessEvidence(session, coach.learnerState, input.answer);
  const transition = session.phase === "DIAGNOSIS" ? nextAfterDiagnosisAnswer(session) : nextAfterSocraticAnswer(session, coach.nextAction, evidence);
  const enteringFeynman = transition.phase === "FEYNMAN";
  const nextRuntime = answeredRuntime && manifest && action ? (enteringFeynman ? answeredRuntime : recordKnowledgeAction(answeredRuntime, action, manifest, coach.learnerState)) : null;
  if (nextRuntime && enteringFeynman) nextRuntime.pedagogicalStage = "FEYNMAN";
  const instruction = enteringFeynman
    ? await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createFeynmanInstruction({ task, learnerState: coach.learnerState, userId: session.userId, sessionId, requestId: `${input.clientRequestId}:feynman` }))
    : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
      if (duplicate) return duplicate.sessionId === sessionId ? "duplicate" as const : Promise.reject(new AppError("CONFLICT", "clientRequestId 已被其他会话使用。", 409));
      const changed = await tx.learningSession.updateMany({
        where: { id: sessionId, version: session.version, phase: session.phase, socraticTurns: session.socraticTurns },
        data: { phase: transition.phase, socraticTurns: transition.socraticTurns, learnerState: asJson(coach.learnerState), ...(nextRuntime ? { knowledgeRuntime: asJson(nextRuntime) } : {}), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      const answerCreatedAt = nextMessageCreatedAt(session.messages);
      await tx.message.create({ data: { sessionId, role: "USER", phase: session.phase, content: input.answer, clientRequestId: input.clientRequestId, createdAt: answerCreatedAt } });
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: transition.phase, content: instruction ? feynmanContent(instruction) : coach.assistantMessage, questionType: instruction ? null : coach.questionType, metadata: asJson(metadataFromCoach(coach)), createdAt: new Date(answerCreatedAt.getTime() + 1) } });
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

export async function requestHint(sessionId: string, input: { clientRequestId: string; expectedVersion?: number }): Promise<SessionPayload & { duplicate: boolean }> {
  hintInputSchema.parse(input);
  if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
  const session = await getRequiredSessionRecord(sessionId);
  assertExpectedSessionVersion(session, input.expectedVersion);
  if (!canRequestHint(session)) throw new AppError("CONFLICT", "当前阶段不能申请提示。", 409);
  if (session.knowledgeRuntime && knowledgeRuntimeSchema.parse(session.knowledgeRuntime).v12) return submitV12Turn(sessionId, "", input.clientRequestId, false, true, input.expectedVersion);
  assertMessageCapacity(session.messages.length, 1);
  const learnerState = session.learnerState === null ? null : learnerStateSchema.parse(session.learnerState);
  const runtime = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
  const manifest = runtime ? await resolveRuntimeManifest(runtime.versions) : undefined;
  const action = runtime && manifest ? selectKnowledgeAction(manifest, runtime, learnerState, session.socraticTurns, true) : null;
  if (runtime && !action) throw new AppError("CONFLICT", "当前题目的提示不可用或已用完，请先尝试回答。", 409);
  const context = await buildLearningContext({ courseId: session.courseId, chapterId: session.chapterId, topic: session.topic, objective: session.objective, contextSummary: session.contextSummary, phase: session.phase, learnerState, knowledgeRuntime: runtime, selectedAction: action, messages: toAiMessages(session.messages) });
  const hint = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createCoachTurn({
    task: buildTaskInput(session), userId: session.userId, sessionId, requestId: input.clientRequestId, phase: session.phase,
    socraticTurns: session.socraticTurns, maxTurns: session.maxTurns, unknownStreak: nextHintLevel(session.messages),
    learnerState, messages: context.recentMessages, contextSummary: context.contextSummary, retrievedContext: context.retrievedContext, isHintRequest: true,
    knowledgePolicy: context.knowledgePolicy,
    selectedAction: action ?? undefined,
  }));
  if (action) {
    hint.assistantMessage = action.assistantMessage;
    hint.knowledgePolicy = "COURSE_KNOWLEDGE_FIRST";
    hint.webSources = [];
  }
  if (learnerState) hint.learnerState = learnerState;
  const nextRuntime = runtime && manifest && action ? recordKnowledgeAction(runtime, action, manifest, learnerState) : null;
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: session.phase }, data: { ...(nextRuntime ? { knowledgeRuntime: asJson(nextRuntime) } : {}), version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: session.phase, content: hint.assistantMessage, questionType: "SCAFFOLDED_HINT", clientRequestId: input.clientRequestId, metadata: asJson(metadataFromCoach(hint)), createdAt: nextMessageCreatedAt(session.messages) } });
    }, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
    if (isWriteConflict(error)) throw new AppError("CONFLICT", "会话正在更新，请重试。", 409, true);
    throw error;
  }
  return { ...(await getSessionPayload(sessionId)), duplicate: false };
}

export async function enterLearningFeynman(sessionId: string, input: { clientRequestId: string; expectedVersion?: number }): Promise<SessionPayload & { duplicate: boolean }> {
  enterFeynmanInputSchema.parse(input);
  if (await findDuplicate(sessionId, input.clientRequestId)) return { ...(await getSessionPayload(sessionId)), duplicate: true };
  const session = await getRequiredSessionRecord(sessionId);
  assertExpectedSessionVersion(session, input.expectedVersion);
  const evidence = readinessEvidence(session);
  const runtime = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
  if (runtime) await resolveRuntimeManifest(runtime.versions);
  if (runtime?.flags.includes("FLAG_NEED_VERIFY")) throw new AppError("CONFLICT", "当前回答仍需独立验证，请继续完成追问。", 409);
  if (runtime?.v12) throw new AppError("CONFLICT", "请先完成独立案例迁移验证。", 409);
  if (!canEnterFeynmanVoluntarily(session, evidence)) throw new AppError("CONFLICT", "尚未形成足够的概念、因果与证据追问，暂不能进入费曼讲解。", 409);
  const transition = enterFeynmanVoluntarily(session, evidence);
  const instruction = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createFeynmanInstruction({ task: buildTaskInput(session), learnerState: evidence.learnerState, userId: session.userId, sessionId, requestId: input.clientRequestId }));
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: session.phase }, data: { phase: transition.phase, ...(runtime ? { knowledgeRuntime: asJson({ ...runtime, pedagogicalStage: "FEYNMAN" }) } : {}), version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { sessionId, role: "ASSISTANT", phase: "FEYNMAN", content: feynmanContent(instruction), clientRequestId: input.clientRequestId, createdAt: nextMessageCreatedAt(session.messages) } });
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

export async function submitFeynmanExplanation(sessionId: string, input: { explanation: string; clientRequestId: string; expectedVersion?: number }): Promise<{ payload: SessionPayload; report: LearningReportDTO | null; duplicate: boolean }> {
  feynmanInputSchema.parse(input);
  try {
    return await saveFeynmanExplanation(sessionId, input);
  } catch (error) {
    // A concurrent replay may finish its AI work after the first request has
    // already committed the report and changed the source gap. Return that
    // exact accepted request, without swallowing conflicts from other requests.
    const committed = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (committed?.sessionId === sessionId && committed.role === "USER" && committed.phase === "FEYNMAN") {
      const payload = await getSessionPayload(sessionId);
      return { payload, report: payload.report, duplicate: true };
    }
    throw error;
  }
}

async function saveFeynmanExplanation(sessionId: string, input: { explanation: string; clientRequestId: string; expectedVersion?: number }): Promise<{ payload: SessionPayload; report: LearningReportDTO | null; duplicate: boolean }> {
  const v12Session = await getRequiredSessionRecord(sessionId);
  if (v12Session.knowledgeRuntime && knowledgeRuntimeSchema.parse(v12Session.knowledgeRuntime).v12) {
    const result = await submitV12Turn(sessionId, input.explanation, input.clientRequestId, true, false, input.expectedVersion);
    return { payload: result, report: result.report, duplicate: result.duplicate };
  }
  if (await findDuplicate(sessionId, input.clientRequestId)) {
    const payload = await getSessionPayload(sessionId);
    if (!payload.report) throw new AppError("NOT_FOUND", "学习报告不存在。", 404);
    return { payload, report: payload.report, duplicate: true };
  }
  const session = await getRequiredSessionRecord(sessionId);
  assertExpectedSessionVersion(session, input.expectedVersion);
  if (!canSubmitFeynman(session)) throw new AppError("CONFLICT", "当前阶段不能提交费曼讲解。", 409);
  assertMessageCapacity(session.messages.length, 1);
  const reporting = nextAfterFeynman(session);
  const runtime = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
  if (runtime) await resolveRuntimeManifest(runtime.versions);
  const reportContext = await buildLearningContext({ topic: session.topic, objective: session.objective, courseId: session.courseId, chapterId: session.chapterId, phase: "REPORTING", knowledgeRuntime: runtime, messages: toAiMessages(session.messages) });
  const draft = await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createLearningReport({
    task: buildTaskInput(session), userId: session.userId, sessionId, requestId: input.clientRequestId,
    messages: [...toAiMessages(session.messages), { role: "USER", phase: "FEYNMAN", content: input.explanation, questionType: null }],
    feynmanExplanation: input.explanation,
    retrievedContext: reportContext.retrievedContext,
  }));
  const report = finalizeReportDraft(draft, runtime ?? undefined);
  const explanationMessageId = crypto.randomUUID();
  const retryReview = await reviewCompletedRetry(session, {
    messages: [
      ...session.messages.filter((message) => message.role === "USER").map(({ id, phase, content }) => ({ id, role: "USER" as const, phase, content })),
      { id: explanationMessageId, role: "USER", phase: "FEYNMAN", content: input.explanation, isIndependentExplanation: true },
    ],
    report: { summary: report.summary, gaps: report.gaps },
  }, input.clientRequestId, runtime);
  const evidenceLinks = linkReportEvidence(report, [...session.messages, { id: explanationMessageId, role: "USER", content: input.explanation }]);
  const completed = nextAfterReportSaved({ ...session, phase: reporting.phase });
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.learningSession.updateMany({ where: { id: sessionId, version: session.version, phase: "FEYNMAN" }, data: { phase: "REPORTING", version: { increment: 1 } } });
      if (changed.count !== 1) throw new AppError("CONFLICT", "会话状态已变化，请刷新后重试。", 409, true);
      await tx.message.create({ data: { id: explanationMessageId, sessionId, role: "USER", phase: "FEYNMAN", content: input.explanation, clientRequestId: input.clientRequestId, createdAt: nextMessageCreatedAt(session.messages) } });
      const createdReport = await tx.learningReport.create({
        data: {
          sessionId, summary: report.summary, overallScore: report.overallScore, overallLevel: report.overallLevel, disclaimer: report.disclaimer,
          ...(runtime ? { sessionVersions: asJson(runtime.versions) } : {}),
          evidenceLinks: asJson(evidenceLinks),
          ...(retryReview ? { retryReview: asJson(retryReview) } : {}),
          dimensions: { create: Object.entries(report.dimensions).map(([key, dimension]) => ({ key: dimensionKeyMap[key as keyof typeof dimensionKeyMap], ...dimension })) },
          strengths: { create: report.strengths.map((strength, position) => ({ ...strength, position })) },
          gaps: { create: report.gaps },
          nextSteps: { create: report.nextSteps.map((description, position) => ({ description, position })) },
        },
      });
      await tx.learningSession.update({ where: { id: sessionId }, data: { phase: completed.phase, ...(runtime ? { knowledgeRuntime: asJson({ ...runtime, pedagogicalStage: "REPORT" }) } : {}), completedAt: new Date(), version: { increment: 1 } } });
      await saveRetryGapStatus(tx, session, retryReview);
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
  return { session: serializePayload(session).session, report: serializeReport(report), messages: serializePayload(session).messages };
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
  const manifest = await findKnowledgeManifest(task.topic, isStudentKnowledgeTaskTopic(task.topic) ? {} : task);
  const retryTask = manifest?.v12 ? { topic: task.topic, objective: `围绕“${gap.title}”开展定向巩固：${gap.repairTask}` } : await withAIRequestProtection(session.userId, sessionId, () => getAIProvider().createRetryTask({ task, gap: { title: gap.title, evidence: gap.evidence, repairTask: gap.repairTask, priority: gap.priority }, userId: session.userId, sessionId, requestId: input.clientRequestId }));
  const childTask = createSessionInputSchema.parse({ ...task, topic: isStudentKnowledgeTaskTopic(task.topic) ? task.topic : retryTask.topic, objective: retryTask.objective, assignmentId: undefined });
  const retryContext = isStudentKnowledgeTaskTopic(task.topic) ? await buildLearningContext({
    courseId: childTask.courseId, chapterId: childTask.chapterId, topic: childTask.topic,
    objective: childTask.objective, phase: "DIAGNOSIS", messages: [],
  }) : undefined;
  const diagnostic = manifest?.v12 ? initialCuratedDiagnostic() : await withAIRequestProtection(session.userId, `${sessionId}:retry`, () => getAIProvider().createDiagnosticQuestion({ task: childTask, userId: session.userId, requestId: `${input.clientRequestId}:diagnostic`, retrievedContext: retryContext?.retrievedContext, knowledgePolicy: retryContext?.knowledgePolicy }));
  let runtime = manifest ? initialKnowledgeRuntime(createVersionSnapshot(manifest)) : null;
  if (runtime && manifest) {
    const previous = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
    if (previous?.versions.releaseId === runtime.versions.releaseId && previous.versions.contentHash === runtime.versions.contentHash) {
      runtime.usedQuestionIds = [...previous.usedQuestionIds];
      runtime.usedCaseIds = [...previous.usedCaseIds];
      runtime.caseExposureCounts = { ...previous.caseExposureCounts };
    }
    const usedQuestionIds = runtime.usedQuestionIds;
    const question = manifest.diagnosticQuestions.find((item) => item.status === "published" && !usedQuestionIds.includes(item.id))
      ?? (runtime.v12 ? manifest.diagnosticQuestions.find((item) => item.status === "published" && item.id !== usedQuestionIds[0]) : undefined);
    if (!question) throw new AppError("CONFLICT", "当前知识版本的诊断题已完成，请开始其他学习任务。", 409);
    diagnostic.assistantMessage = question.questionText;
    diagnostic.knowledgePolicy = "COURSE_KNOWLEDGE_FIRST";
    diagnostic.webSources = [];
    runtime.currentQuestionId = question.id;
    runtime.currentTargetId = question.targetConcepts[0];
    runtime.usedQuestionIds.push(question.id);
    if (runtime.v12) {
      runtime.v12 = presentV12Goal(runtime.v12, new Date().toISOString());
      runtime.currentQuestionId = null; runtime.currentTargetId = null;
      runtime.usedQuestionIds = runtime.usedQuestionIds.filter((id) => id !== question.id);
      diagnostic.assistantMessage = `定向巩固目标：${childTask.objective}\n\n预计用时：15–20分钟。`;
      const now = new Date().toISOString();
      const coaching = await selectCoaching(manifest, runtime, { kind: "RETRY", content: diagnostic.assistantMessage, learnerLevel: childTask.learnerLevel, studentContent: gap.evidence }, { userId: session.userId, sessionId, requestId: `${input.clientRequestId}:teaching` }, `${sessionId}:retry`);
      const presented = recordCoaching(runtime, coaching.prepared, coaching.decision, { requestId: `${input.clientRequestId}:teaching`, now });
      runtime = knowledgeRuntimeSchema.parse(presented.runtime);
      diagnostic.assistantMessage = presented.assistantMessage;
    }
  }
  try {
    const childId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.learningGap.updateMany({ where: { id: gap.id, status: "OPEN" }, data: { status: "IN_PROGRESS" } });
      if (claimed.count !== 1) throw new AppError("CONFLICT", "该学习漏洞已开始巩固，请继续已有的再练会话。", 409);
      const child = await tx.learningSession.create({
        data: {
          userId: session.userId, courseId: session.courseId, chapterId: session.chapterId, learningGoalId: session.learningGoalId,
          source: "RETRY", course: childTask.course, chapter: childTask.chapter, topic: childTask.topic, objective: childTask.objective,
          learnerLevel: childTask.learnerLevel, referenceText: childTask.referenceText, parentSessionId: sessionId, sourceGapId: gap.id,
          learnerState: asJson(diagnostic.learnerState),
          ...(runtime ? { knowledgeRuntime: asJson(runtime) } : {}),
          messages: { create: { role: "ASSISTANT", phase: "DIAGNOSIS", content: diagnostic.assistantMessage, questionType: diagnostic.questionType, metadata: asJson(metadataFromCoach(diagnostic)) } },
        },
      });
      await tx.message.create({ data: { sessionId, role: "SYSTEM", phase: "COMPLETED", content: "已创建针对最高优先级漏洞的再练会话。", clientRequestId: input.clientRequestId, metadata: asJson({ retrySessionId: child.id }), createdAt: nextMessageCreatedAt(session.messages) } });
      await tx.auditLog.create({ data: { actorId: session.userId, action: "SESSION_CREATED", targetType: "LearningSession", targetId: child.id, requestId: input.clientRequestId, metadata: { parentSessionId: sessionId } } });
      return child.id;
    }, { isolationLevel: "ReadCommitted" });
    return { ...(await getSessionPayload(childId)), duplicate: false };
  } catch (error) {
    if (!isUniqueConstraintError(error) && !(error instanceof AppError && error.code === "CONFLICT")) throw error;
    const marker = await prisma.message.findUnique({ where: { clientRequestId: input.clientRequestId } });
    const retryId = marker?.sessionId === sessionId && marker.metadata ? messageMetadataSchema.parse(marker.metadata).retrySessionId : undefined;
    if (!retryId) throw error;
    return { ...(await getSessionPayload(retryId)), duplicate: true };
  }
}
