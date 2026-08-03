import type { LearningReport, LearningSession, Message } from "@prisma/client";
import {
  DimensionKey,
  LearningReportDTO,
  LearningReportDraft,
  LearningSessionDTO,
  MessageDTO,
  ReportDimension,
  SessionPayload,
  dimensionKeys,
  learningReportDraftSchema,
} from "./contracts";

type SessionRecord = LearningSession & {
  messages: Message[];
  report: LearningReport | null;
};

export function serializeSession(session: LearningSession): LearningSessionDTO {
  return {
    id: session.id,
    course: session.course,
    chapter: session.chapter,
    topic: session.topic,
    goal: session.goal,
    learnerLevel: session.learnerLevel,
    referenceText: session.referenceText,
    phase: session.phase,
    socraticRound: session.socraticRound,
    unknownStreak: session.unknownStreak,
    feynmanExplanation: session.feynmanExplanation,
    parentSessionId: session.parentSessionId,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export function serializeMessage(message: Message): MessageDTO {
  return {
    id: message.id,
    role: message.role,
    phase: message.phase,
    content: message.content,
    questionType: message.questionType,
    clientRequestId: message.clientRequestId,
    createdAt: message.createdAt.toISOString(),
  };
}

function parseJsonArray(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseDimensions(value: string) {
  const parsed = JSON.parse(value) as unknown;
  const draft = learningReportDraftSchema
    .pick({ dimensions: true })
    .parse({ dimensions: parsed });
  return draft.dimensions as Record<DimensionKey, ReportDimension>;
}

export function serializeReport(report: LearningReport): LearningReportDTO {
  return {
    id: report.id,
    sessionId: report.sessionId,
    summary: report.summary,
    dimensions: parseDimensions(report.dimensionsJson),
    mastered: parseJsonArray(report.masteredJson),
    gaps: parseJsonArray(report.gapsJson),
    nextSteps: parseJsonArray(report.nextStepsJson),
    scores: {
      conceptScore: report.conceptScore,
      logicScore: report.logicScore,
      clarityScore: report.clarityScore,
      exampleScore: report.exampleScore,
      transferScore: report.transferScore,
      overallScore: report.overallScore,
    },
    disclaimer: report.disclaimer,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export function serializePayload(session: SessionRecord): SessionPayload {
  return {
    session: serializeSession(session),
    messages: session.messages.map(serializeMessage),
    report: session.report ? serializeReport(session.report) : null,
  };
}

export function serializeReportDraftForStorage(draft: LearningReportDraft) {
  const dimensions = dimensionKeys.reduce<Record<DimensionKey, ReportDimension>>(
    (acc, key) => {
      acc[key] = draft.dimensions[key];
      return acc;
    },
    {} as Record<DimensionKey, ReportDimension>,
  );

  return {
    dimensionsJson: JSON.stringify(dimensions),
    masteredJson: JSON.stringify(draft.mastered),
    gapsJson: JSON.stringify(draft.gaps),
    nextStepsJson: JSON.stringify(draft.nextSteps),
  };
}
