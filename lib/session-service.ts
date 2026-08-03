import { Prisma } from "@prisma/client";
import {
  CreateSessionInput,
  LearningReportDTO,
  MAX_MESSAGES_PER_SESSION,
  MAX_SOCRATIC_ROUNDS,
  SessionPayload,
  createSessionInputSchema,
  dimensionLabels,
  feynmanInputSchema,
  hintInputSchema,
  reportDisclaimer,
  QuestionType,
  retryInputSchema,
} from "./contracts";
import { getAIProvider } from "./ai";
import { prisma } from "./db";
import { AppError } from "./errors";
import { hasDuplicateClientRequest } from "./idempotency";
import { finalizeReportDraft, getLowestDimension } from "./scoring";
import {
  canRequestHint,
  canRetrySession,
  canSubmitAnswer,
  canSubmitFeynman,
  computeUnknownStreak,
  nextAfterDiagnosisAnswer,
  nextAfterSocraticAnswer,
} from "./state-machine";
import {
  serializePayload,
  serializeReport,
  serializeReportDraftForStorage,
} from "./serializers";

const sessionInclude = {
  messages: {
    orderBy: {
      createdAt: "asc",
    },
  },
  report: true,
} satisfies Prisma.LearningSessionInclude;

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function buildTaskInput(session: {
  course: string | null;
  chapter: string | null;
  topic: string;
  goal: string;
  learnerLevel: string;
  referenceText: string | null;
}): CreateSessionInput {
  return createSessionInputSchema.parse({
    course: session.course ?? undefined,
    chapter: session.chapter ?? undefined,
    topic: session.topic,
    goal: session.goal,
    learnerLevel: session.learnerLevel,
    referenceText: session.referenceText ?? undefined,
  });
}

function toAiMessages(
  messages: {
    role: "USER" | "ASSISTANT" | "SYSTEM_EVENT";
    phase: "DIAGNOSIS" | "SOCRATIC" | "FEYNMAN" | "COMPLETED";
    content: string;
    questionType:
      | "CONCEPT_CLARIFICATION"
      | "CAUSE_PROBE"
      | "ASSUMPTION_TEST"
      | "COUNTEREXAMPLE"
      | "TRANSFER"
      | "SCAFFOLDED_HINT"
      | null;
  }[],
) {
  return messages.map((message) => ({
    role: message.role,
    phase: message.phase,
    content: message.content,
    questionType: message.questionType,
  }));
}

async function getSessionRecord(id: string) {
  return prisma.learningSession.findUnique({
    where: { id },
    include: sessionInclude,
  });
}

async function getRequiredSessionRecord(id: string) {
  const session = await getSessionRecord(id);
  if (!session) {
    throw new AppError("SESSION_NOT_FOUND", "学习会话不存在。", 404);
  }
  return session;
}

function feynmanPrompt(topic: string) {
  return `请进入费曼讲解：用自己的话向一位刚接触“${topic}”的同学解释它。请包含核心概念、原因链条、一个例子，以及它在新场景中的适用条件。`;
}

export async function getSessionPayload(id: string): Promise<SessionPayload> {
  return serializePayload(await getRequiredSessionRecord(id));
}

export async function createLearningSession(
  input: CreateSessionInput,
  parentSessionId?: string,
  retryRequestId?: string,
): Promise<SessionPayload> {
  const provider = getAIProvider();
  const diagnostic = await provider.createDiagnosticQuestion({ task: input });

  const created = await prisma.learningSession.create({
    data: {
      course: input.course,
      chapter: input.chapter,
      topic: input.topic,
      goal: input.goal,
      learnerLevel: input.learnerLevel,
      referenceText: input.referenceText,
      parentSessionId,
      retryRequestId,
      messages: {
        create: {
          role: "ASSISTANT",
          phase: "DIAGNOSIS",
          content: diagnostic.question,
          questionType: diagnostic.questionType,
        },
      },
    },
    include: sessionInclude,
  });

  return serializePayload(created);
}

export async function submitLearningAnswer(
  sessionId: string,
  input: {
    answer: string;
    clientRequestId: string;
  },
): Promise<SessionPayload & { duplicate: boolean }> {
  const session = await getRequiredSessionRecord(sessionId);

  if (hasDuplicateClientRequest(session.messages, input.clientRequestId)) {
    return {
      ...(await getSessionPayload(sessionId)),
      duplicate: true,
    };
  }

  if (!canSubmitAnswer(session)) {
    throw new AppError("INVALID_PHASE", "当前阶段不能提交普通回答。", 409);
  }

  if (session.messages.length >= MAX_MESSAGES_PER_SESSION) {
    throw new AppError("MESSAGE_LIMIT_REACHED", "本会话消息数量已达上限。", 409);
  }

  const nextUnknownStreak = computeUnknownStreak(
    input.answer,
    session.unknownStreak,
  );

  const task = buildTaskInput(session);
  const provider = getAIProvider();
  let nextPhase = session.phase;
  let nextRound = session.socraticRound;
  let assistantContent = "";
  let assistantQuestionType: QuestionType | undefined;

  if (session.phase === "DIAGNOSIS") {
    const coach = await provider.createCoachTurn({
      task,
      phase: "SOCRATIC",
      socraticRound: 0,
      unknownStreak: nextUnknownStreak,
      messages: [
        ...toAiMessages(session.messages),
        {
          role: "USER",
          phase: "DIAGNOSIS",
          content: input.answer,
          questionType: null,
        },
      ],
      latestAnswer: input.answer,
    });
    const transition = nextAfterDiagnosisAnswer();
    nextPhase = transition.phase;
    nextRound = transition.socraticRound;
    assistantContent = coach.question;
    assistantQuestionType = coach.questionType;
  } else {
    nextRound = session.socraticRound + 1;

    if (nextRound >= MAX_SOCRATIC_ROUNDS) {
      const transition = nextAfterSocraticAnswer(session, "CONTINUE");
      nextPhase = transition.phase;
      nextRound = transition.socraticRound;
      assistantContent = feynmanPrompt(session.topic);
    } else {
      const coach = await provider.createCoachTurn({
        task,
        phase: "SOCRATIC",
        socraticRound: nextRound,
        unknownStreak: nextUnknownStreak,
        messages: [
          ...toAiMessages(session.messages),
          {
            role: "USER",
            phase: "SOCRATIC",
            content: input.answer,
            questionType: null,
          },
        ],
        latestAnswer: input.answer,
      });
      const transition = nextAfterSocraticAnswer(session, coach.suggestion);
      nextPhase = transition.phase;
      nextRound = transition.socraticRound;
      assistantContent =
        nextPhase === "FEYNMAN" ? feynmanPrompt(session.topic) : coach.question;
      assistantQuestionType =
        nextPhase === "FEYNMAN" ? undefined : coach.questionType;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.learningSession.findUnique({
        where: { id: sessionId },
        select: {
          phase: true,
          socraticRound: true,
        },
      });

      if (!current) {
        throw new AppError("SESSION_NOT_FOUND", "学习会话不存在。", 404);
      }

      if (
        current.phase !== session.phase ||
        current.socraticRound !== session.socraticRound
      ) {
        throw new AppError(
          "SESSION_STATE_CHANGED",
          "会话状态已变化，请刷新后重试。",
          409,
          true,
        );
      }

      await tx.message.create({
        data: {
          sessionId,
          role: "USER",
          phase: session.phase,
          content: input.answer,
          clientRequestId: input.clientRequestId,
        },
      });

      await tx.learningSession.update({
        where: { id: sessionId },
        data: {
          phase: nextPhase,
          socraticRound: nextRound,
          unknownStreak: nextUnknownStreak,
        },
      });

      await tx.message.create({
        data: {
          sessionId,
          role: "ASSISTANT",
          phase: nextPhase,
          content: assistantContent,
          questionType: assistantQuestionType,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ...(await getSessionPayload(sessionId)),
        duplicate: true,
      };
    }
    throw error;
  }

  return {
    ...(await getSessionPayload(sessionId)),
    duplicate: false,
  };
}

export async function requestHint(
  sessionId: string,
  input: {
    clientRequestId: string;
  },
): Promise<SessionPayload & { duplicate: boolean }> {
  hintInputSchema.parse(input);
  const session = await getRequiredSessionRecord(sessionId);

  if (hasDuplicateClientRequest(session.messages, input.clientRequestId)) {
    return {
      ...(await getSessionPayload(sessionId)),
      duplicate: true,
    };
  }

  if (!canRequestHint(session)) {
    throw new AppError("INVALID_PHASE", "当前阶段不能申请提示。", 409);
  }

  if (session.messages.length >= MAX_MESSAGES_PER_SESSION) {
    throw new AppError("MESSAGE_LIMIT_REACHED", "本会话消息数量已达上限。", 409);
  }

  const task = buildTaskInput(session);
  const hint = await getAIProvider().createCoachTurn({
    task,
    phase: session.phase,
    socraticRound: session.socraticRound,
    unknownStreak: Math.max(1, session.unknownStreak),
    messages: toAiMessages(session.messages),
    isHintRequest: true,
  });

  try {
    await prisma.message.create({
      data: {
        sessionId,
        role: "ASSISTANT",
        phase: session.phase,
        content: hint.question,
        questionType: "SCAFFOLDED_HINT",
        clientRequestId: input.clientRequestId,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ...(await getSessionPayload(sessionId)),
        duplicate: true,
      };
    }
    throw error;
  }

  return {
    ...(await getSessionPayload(sessionId)),
    duplicate: false,
  };
}

export async function submitFeynmanExplanation(
  sessionId: string,
  input: {
    explanation: string;
    clientRequestId: string;
  },
): Promise<{ payload: SessionPayload; report: LearningReportDTO; duplicate: boolean }> {
  feynmanInputSchema.parse(input);
  const session = await getRequiredSessionRecord(sessionId);

  if (
    hasDuplicateClientRequest(session.messages, input.clientRequestId) &&
    session.report
  ) {
    const payload = await getSessionPayload(sessionId);
    return {
      payload,
      report: serializeReport(session.report),
      duplicate: true,
    };
  }

  if (!canSubmitFeynman(session)) {
    throw new AppError("INVALID_PHASE", "当前阶段不能提交费曼讲解。", 409);
  }

  if (session.messages.length >= MAX_MESSAGES_PER_SESSION) {
    throw new AppError("MESSAGE_LIMIT_REACHED", "本会话消息数量已达上限。", 409);
  }

  const task = buildTaskInput(session);
  const draft = await getAIProvider().createLearningReport({
    task,
    messages: toAiMessages(session.messages),
    feynmanExplanation: input.explanation,
  });
  const finalReport = finalizeReportDraft(draft);
  const storage = serializeReportDraftForStorage(draft);

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.learningSession.findUnique({
        where: { id: sessionId },
        select: {
          phase: true,
        },
      });

      if (!current) {
        throw new AppError("SESSION_NOT_FOUND", "学习会话不存在。", 404);
      }

      if (current.phase !== "FEYNMAN") {
        throw new AppError(
          "SESSION_STATE_CHANGED",
          "会话状态已变化，请刷新后重试。",
          409,
          true,
        );
      }

      await tx.message.create({
        data: {
          sessionId,
          role: "USER",
          phase: "FEYNMAN",
          content: input.explanation,
          clientRequestId: input.clientRequestId,
        },
      });

      await tx.learningSession.update({
        where: { id: sessionId },
        data: {
          phase: "COMPLETED",
          feynmanExplanation: input.explanation,
        },
      });

      await tx.learningReport.create({
        data: {
          sessionId,
          summary: finalReport.summary,
          conceptScore: finalReport.dimensions.conceptCompleteness.score,
          logicScore: finalReport.dimensions.logicCompleteness.score,
          clarityScore: finalReport.dimensions.expressionClarity.score,
          exampleScore: finalReport.dimensions.exampleAbility.score,
          transferScore: finalReport.dimensions.transferAbility.score,
          overallScore: finalReport.overallScore,
          dimensionsJson: storage.dimensionsJson,
          masteredJson: storage.masteredJson,
          gapsJson: storage.gapsJson,
          nextStepsJson: storage.nextStepsJson,
          disclaimer: reportDisclaimer,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const payload = await getSessionPayload(sessionId);
      if (!payload.report) {
        throw error;
      }
      return {
        payload,
        report: payload.report,
        duplicate: true,
      };
    }
    throw error;
  }

  const payload = await getSessionPayload(sessionId);
  if (!payload.report) {
    throw new AppError("REPORT_NOT_FOUND", "学习报告生成失败。", 500);
  }

  return {
    payload,
    report: payload.report,
    duplicate: false,
  };
}

export async function getReportPayload(sessionId: string) {
  const report = await prisma.learningReport.findUnique({
    where: { sessionId },
  });

  if (!report) {
    throw new AppError("REPORT_NOT_FOUND", "学习报告不存在。", 404);
  }

  const session = await getRequiredSessionRecord(sessionId);
  return {
    session: serializePayload(session).session,
    report: serializeReport(report),
  };
}

export async function createRetrySession(
  sessionId: string,
  input: { clientRequestId: string },
): Promise<SessionPayload & { duplicate: boolean }> {
  retryInputSchema.parse(input);
  const session = await getRequiredSessionRecord(sessionId);
  if (!canRetrySession(session)) {
    throw new AppError("INVALID_PHASE", "只有已完成会话可以再练一轮。", 409);
  }
  if (!session.report) {
    throw new AppError("REPORT_NOT_FOUND", "缺少学习报告，无法再练。", 404);
  }

  const existingRetry = await prisma.learningSession.findFirst({
    where: {
      parentSessionId: sessionId,
      retryRequestId: input.clientRequestId,
    },
    include: sessionInclude,
  });
  if (existingRetry) {
    return {
      ...serializePayload(existingRetry),
      duplicate: true,
    };
  }

  const report = serializeReport(session.report);
  const lowest = getLowestDimension(report.dimensions);
  const primaryGap = report.gaps[0] ?? dimensionLabels[lowest];
  const task = buildTaskInput(session);

  try {
    return {
      ...(await createLearningSession(
        {
          ...task,
          goal: `针对最大漏洞再练一轮：${primaryGap}`,
          referenceText: task.referenceText,
        },
        session.id,
        input.clientRequestId,
      )),
      duplicate: false,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const duplicateRetry = await prisma.learningSession.findFirst({
      where: {
        parentSessionId: sessionId,
        retryRequestId: input.clientRequestId,
      },
      include: sessionInclude,
    });
    if (!duplicateRetry) {
      throw error;
    }
    return {
      ...serializePayload(duplicateRetry),
      duplicate: true,
    };
  }
}
