import type { LearningSession, Message, Prisma } from "@prisma/client";
import { z } from "zod";
import { knowledgeRuntimeSchema, sessionVersionsSchema } from "./knowledge/runtime-schemas";
import { reportEvidenceLinksSchema } from "./knowledge/report-evidence";
import { v12StateSchema } from "./knowledge/v12-schema";
import { retryReviewSchema } from "./retry-review";
import { answeredSocraticQuestionTypes, canEnterFeynmanVoluntarily, canRequestHint } from "./state-machine";
import {
  type LearningReportDTO,
  type LearningSessionDTO,
  type MessageDTO,
  reportGapsSchema,
  messageMetadataSchema,
  type SessionPayload,
  learnerStateSchema,
} from "./contracts";

export const reportRelations = {
  dimensions: true,
  strengths: { orderBy: { position: "asc" as const } },
  gaps: {
    orderBy: [{ priority: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }],
    include: { retrySessions: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { id: true, phase: true } } },
  },
  nextSteps: { orderBy: { position: "asc" as const } },
} satisfies Prisma.LearningReportInclude;

export const sessionRelations = {
  messages: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
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
  const runtime = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
  return {
    ...(runtime?.v12 ? { knowledgeProgress: { pedagogicalStage: runtime.v12.pedagogicalStage, diagnosticLevel: runtime.v12.diagnosticLevel, experienceLimitReached: runtime.v12.experienceLimitReached, resumeVerification: Boolean(runtime.v12.resumeVerification), resumeRequired: !runtime.v12.resumeVerification && Object.keys(runtime.v12.assessments).length > 0 && Date.now() - session.updatedAt.getTime() >= 30 * 60_000 } } : {}),
    id: session.id,
    version: session.version,
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
  const metadata = message.metadata === null ? null : messageMetadataSchema.safeParse(message.metadata);
  const parsedMetadata = metadata?.success ? metadata.data : null;
  return {
    id: message.id,
    role: message.role,
    phase: message.phase,
    content: message.content,
    questionType: message.questionType,
    clientRequestId: message.clientRequestId,
    webSources: parsedMetadata?.webSources ?? [],
    knowledgePolicy: parsedMetadata?.knowledgePolicy ?? null,
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
    retryReview: report.retryReview ? retryReviewSchema.parse(report.retryReview) : null,
    sessionVersions: report.sessionVersions ? sessionVersionsSchema.parse(report.sessionVersions) : null,
    evidenceAudit: report.evidenceAudit ? v12StateSchema.parse(report.evidenceAudit) : null,
    evidenceLinks: report.evidenceLinks ? reportEvidenceLinksSchema.parse(report.evidenceLinks) : null,
    id: report.id,
    sessionId: report.sessionId,
    summary: report.summary,
    overallScore: report.overallScore,
    overallLevel: report.overallLevel,
    dimensions: z.object({ conceptCompleteness: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), logicCompleteness: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), expressionClarity: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), exampleAbility: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }), transferAbility: z.object({ score: z.number(), evidence: z.string(), feedback: z.string() }) }).parse(dimensions),
    strengths: report.strengths.map(({ title, evidence }) => ({ title, evidence })),
    gaps: report.gaps.map(({ title, evidence, repairTask, priority, status, retrySessions }) => ({
      title, evidence, repairTask, priority, status,
      ...(retrySessions[0] ? { latestRetry: { sessionId: retrySessions[0].id, phase: retrySessions[0].phase } } : {}),
    })),
    nextSteps: report.nextSteps.map((step) => step.description),
    disclaimer: report.disclaimer,
    createdAt: report.createdAt.toISOString(),
  };
}

export function serializePayload(session: SessionRecord): SessionPayload {
  const runtime = session.knowledgeRuntime ? knowledgeRuntimeSchema.parse(session.knowledgeRuntime) : null;
  const learner = learnerStateSchema.safeParse(session.learnerState);
  const canHint = runtime?.v12?.pedagogicalStage !== "GOAL_PRESENTATION" && !runtime?.v12?.resumeVerification && canRequestHint(session) && (!runtime || Boolean(runtime.currentTargetId && (runtime.hintLevels[runtime.currentTargetId] ?? 0) < 2));
  const canEnter = !runtime?.v12 && !runtime?.flags.includes("FLAG_NEED_VERIFY") && canEnterFeynmanVoluntarily(session, {
    learnerState: learner.success ? learner.data : null,
    answeredQuestionTypes: answeredSocraticQuestionTypes(session.messages),
  });
  return {
    availableActions: { canRequestHint: canHint, canEnterFeynman: canEnter },
    session: serializeSession(session),
    messages: session.messages.map(serializeMessage),
    report: session.report ? serializeReport(session.report) : null,
  };
}
