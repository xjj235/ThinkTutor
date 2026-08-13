import type { LearningSession, Message, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  type LearningReportDTO,
  type LearningSessionDTO,
  type MessageDTO,
  reportGapsSchema,
  type SessionPayload,
} from "./contracts";

export const reportRelations = {
  dimensions: true,
  strengths: { orderBy: { position: "asc" as const } },
  gaps: { orderBy: [{ priority: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }] },
  nextSteps: { orderBy: { position: "asc" as const } },
} satisfies Prisma.LearningReportInclude;

export const sessionRelations = {
  messages: { orderBy: { createdAt: "asc" as const } },
  report: { include: reportRelations },
} satisfies Prisma.LearningSessionInclude;

type ReportRecord = Prisma.LearningReportGetPayload<{ include: typeof reportRelations }>;
type SessionRecord = Prisma.LearningSessionGetPayload<{ include: typeof sessionRelations }>;

const legacyReportGapsSchema = z.array(z.string().trim().min(1).max(180)).max(8);

export function normalizeReportGaps(value: unknown) {
  const current = reportGapsSchema.safeParse(value);
  if (current.success) return current.data;
  return legacyReportGapsSchema.parse(value).map((title) => ({
    title,
    evidence: "旧版报告未保存该漏洞的独立证据，需要复核原始学习对话。",
    repairTask: `围绕“${title}”完成一次针对性解释，并补充可核查证据。`,
    priority: 3,
  }));
}

export function serializeSession(session: LearningSession): LearningSessionDTO {
  return {
    id: session.id,
    course: session.course,
    chapter: session.chapter,
    topic: session.topic,
    objective: session.objective,
    learnerLevel: session.learnerLevel,
    hasReferenceMaterial: Boolean(session.referenceText),
    phase: session.phase,
    socraticTurns: session.socraticTurns,
    maxTurns: session.maxTurns,
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

const dimensionKeyMap = {
  CONCEPT_COMPLETENESS: "conceptCompleteness",
  LOGIC_COMPLETENESS: "logicCompleteness",
  EXPRESSION_CLARITY: "expressionClarity",
  EXAMPLE_ABILITY: "exampleAbility",
  TRANSFER_ABILITY: "transferAbility",
} as const;

export function serializeReport(report: ReportRecord): LearningReportDTO {
  const dimensions = Object.fromEntries(
    report.dimensions.map((dimension) => [dimensionKeyMap[dimension.key], { score: dimension.score, evidence: dimension.evidence, feedback: dimension.feedback }]),
  );
  return {
    id: report.id,
    sessionId: report.sessionId,
    summary: report.summary,
    overallScore: report.overallScore,
    overallLevel: report.overallLevel,
    dimensions: z.object({ conceptCompleteness: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), logicCompleteness: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), expressionClarity: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), exampleAbility: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), transferAbility: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }) }).parse(dimensions),
    strengths: report.strengths.map((strength) => strength.title),
    gaps: report.gaps.map(({ title, evidence, repairTask, priority }) => ({ title, evidence, repairTask, priority })),
    nextSteps: report.nextSteps.map((step) => step.description),
    disclaimer: report.disclaimer,
    createdAt: report.createdAt.toISOString(),
  };
}

export function serializePayload(session: SessionRecord): SessionPayload {
  return {
    session: serializeSession(session),
    messages: session.messages.map(serializeMessage),
    report: session.report ? serializeReport(session.report) : null,
  };
}
