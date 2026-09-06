import { z } from "zod";

export const learningPhaseValues = [
  "DIAGNOSIS",
  "SOCRATIC",
  "FEYNMAN",
  "REPORTING",
  "COMPLETED",
  "ABANDONED",
] as const;

export const messageRoleValues = ["USER", "ASSISTANT", "SYSTEM"] as const;

export const questionTypeValues = [
  "CONCEPT_CLARIFICATION",
  "CAUSE_PROBE",
  "ASSUMPTION_TEST",
  "COUNTEREXAMPLE",
  "EVIDENCE_PROBE",
  "TRANSFER",
  "SCAFFOLDED_HINT",
] as const;

export const coachNextActionValues = [
  "ASK_QUESTION",
  "REQUEST_FEYNMAN",
] as const;

export const dimensionKeys = [
  "conceptCompleteness",
  "logicCompleteness",
  "expressionClarity",
  "exampleAbility",
  "transferAbility",
] as const;

export type LearningPhase = (typeof learningPhaseValues)[number];
export type MessageRole = (typeof messageRoleValues)[number];
export type QuestionType = (typeof questionTypeValues)[number];
export type CoachNextAction = (typeof coachNextActionValues)[number];
export type DimensionKey = (typeof dimensionKeys)[number];

export const phaseLabels: Record<LearningPhase, string> = {
  DIAGNOSIS: "认知诊断",
  SOCRATIC: "苏格拉底追问",
  FEYNMAN: "费曼阐释",
  REPORTING: "生成报告",
  COMPLETED: "学习报告",
  ABANDONED: "已结束",
};

export const questionTypeLabels: Record<QuestionType, string> = {
  CONCEPT_CLARIFICATION: "概念澄清",
  CAUSE_PROBE: "原因追问",
  ASSUMPTION_TEST: "假设检验",
  COUNTEREXAMPLE: "反例思考",
  EVIDENCE_PROBE: "证据追问",
  TRANSFER: "迁移应用",
  SCAFFOLDED_HINT: "支架提示",
};

export const dimensionLabels: Record<DimensionKey, string> = {
  conceptCompleteness: "概念完整度",
  logicCompleteness: "逻辑完整度",
  expressionClarity: "表达清晰度",
  exampleAbility: "举例能力",
  transferAbility: "迁移能力",
};

export const MAX_MESSAGES_PER_SESSION = 40;
export const MIN_SOCRATIC_TURNS = 3;
export const MAX_SOCRATIC_TURNS = 5;
export const DEFAULT_MAX_TURNS = 5;
export const MIN_ANSWER_LENGTH = 10;
export const MIN_FEYNMAN_EXPLANATION_LENGTH = 30;

export const textLimits = {
  course: 80,
  chapter: 120,
  topic: 120,
  objective: 400,
  learnerLevel: 80,
  referenceText: 8000,
  answer: 2000,
  feynmanExplanation: 4000,
  clientRequestId: 80,
} as const;

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}不能超过 ${max} 个字。`)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

export const createSessionInputSchema = z
  .object({
    assignmentId: z.string().trim().min(10).max(40).optional(),
    courseId: z.string().trim().min(10).max(40).optional(),
    chapterId: z.string().trim().min(10).max(40).optional(),
    learningGoalId: z.string().trim().min(10).max(40).optional(),
    course: optionalTrimmed(textLimits.course, "课程"),
    chapter: optionalTrimmed(textLimits.chapter, "章节"),
    topic: z.string().trim().min(1, "请填写知识点。").max(textLimits.topic),
    objective: z
      .string()
      .trim()
      .min(1, "请填写学习目标。")
      .max(textLimits.objective),
    learnerLevel: z
      .string()
      .trim()
      .min(1, "请选择学习者水平。")
      .max(textLimits.learnerLevel),
    referenceText: optionalTrimmed(textLimits.referenceText, "参考材料"),
  })
  .strict();

export const createSessionRequestSchema = createSessionInputSchema
  .extend({
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const answerInputSchema = z
  .object({
    answer: z
      .string()
      .trim()
      .min(MIN_ANSWER_LENGTH, `回答不能少于 ${MIN_ANSWER_LENGTH} 个字。`)
      .max(textLimits.answer),
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const hintInputSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const feynmanInputSchema = z
  .object({
    explanation: z
      .string()
      .trim()
      .min(
        MIN_FEYNMAN_EXPLANATION_LENGTH,
        `费曼讲解不能少于 ${MIN_FEYNMAN_EXPLANATION_LENGTH} 个字。`,
      )
      .max(textLimits.feynmanExplanation),
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const retryInputSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const enterFeynmanInputSchema = z
  .object({
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const sessionIdSchema = z.string().trim().min(1).max(64);
export const learningPhaseSchema = z.enum(learningPhaseValues);
export const messageRoleSchema = z.enum(messageRoleValues);
export const questionTypeSchema = z.enum(questionTypeValues);
export const coachNextActionSchema = z.enum(coachNextActionValues);

export const learnerStateSchema = z
  .object({
    masteryEstimate: z.number().int().min(0).max(100),
    confirmedPoints: z.array(z.string()).max(5),
    gaps: z.array(z.string()).max(5),
    misconceptions: z.array(z.string()).max(5),
  })
  .strict();

export const singleQuestionTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => (value.match(/[?？]/g) ?? []).length === 1,
    "AI output must contain exactly one main question.",
  )
  .refine(
    (value) => !/(?:^|\n)\s*(?:[-*•]|\d+[.)、])\s+/m.test(value),
    "AI output must not contain a question list.",
  );

export const coachTurnSchema = z
  .object({
    assistantMessage: singleQuestionTextSchema,
    questionType: questionTypeSchema,
    learnerState: learnerStateSchema,
    nextAction: coachNextActionSchema,
    transitionReason: z.string().max(300),
  })
  .strict();

export const diagnosticQuestionSchema = coachTurnSchema.superRefine(
  (value, context) => {
    if (value.questionType !== "CONCEPT_CLARIFICATION") {
      context.addIssue({
        code: "custom",
        message: "Diagnostic output must clarify the core concept.",
        path: ["questionType"],
      });
    }
    if (value.nextAction !== "ASK_QUESTION") {
      context.addIssue({
        code: "custom",
        message: "Diagnostic output must ask a question.",
        path: ["nextAction"],
      });
    }
  },
);

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export const webSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    url: z.string().trim().min(1).max(2_000).refine(isSafeHttpsUrl, "来源 URL 必须是无凭据的 HTTPS 地址。"),
  })
  .strict();

export const messageMetadataSchema = z
  .object({
    learnerState: learnerStateSchema.optional(),
    nextAction: coachNextActionSchema.optional(),
    transitionReason: z.string().max(300).optional(),
    retrySessionId: z.string().trim().min(1).max(64).optional(),
    knowledgePolicy: z.enum(["COURSE_KNOWLEDGE_FIRST", "MODEL_FALLBACK", "WEB_SEARCH_FALLBACK"]).optional(),
    webSources: z.array(webSourceSchema).max(5).optional(),
  })
  .strict();

export const reportDimensionSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    evidence: z.string().trim().min(1).max(600),
    feedback: z.string().trim().min(1).max(400),
  })
  .strict();

export const reportDimensionsSchema = z
  .object({
    conceptCompleteness: reportDimensionSchema,
    logicCompleteness: reportDimensionSchema,
    expressionClarity: reportDimensionSchema,
    exampleAbility: reportDimensionSchema,
    transferAbility: reportDimensionSchema,
  })
  .strict();

export const reportStrengthSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    evidence: z.string().trim().min(1).max(600),
  })
  .strict();
export const strengthsSchema = z.array(reportStrengthSchema).max(5);
export const reportGapSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    evidence: z.string().trim().min(1).max(600),
    repairTask: z.string().trim().min(1).max(400),
    priority: z.number().int().min(1).max(5),
  })
  .strict();
export const reportGapsSchema = z.array(reportGapSchema).max(5);
export const nextStepsSchema = z.array(z.string().trim().min(1).max(220)).max(3);

export const reportDisclaimer =
  "本报告仅依据本次学习对话生成，属于形成性学习反馈，不代表标准化能力测评结果。";

export const learningReportDraftSchema = z
  .object({
    summary: z.string().trim().min(1).max(1000),
    overallLevel: z.string().trim().min(1).max(50),
    dimensions: reportDimensionsSchema,
    strengths: strengthsSchema,
    gaps: reportGapsSchema,
    nextSteps: nextStepsSchema,
    disclaimer: z.literal(reportDisclaimer),
  })
  .strict();

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type AnswerInput = z.infer<typeof answerInputSchema>;
export type HintInput = z.infer<typeof hintInputSchema>;
export type FeynmanInput = z.infer<typeof feynmanInputSchema>;
export type RetryInput = z.infer<typeof retryInputSchema>;
export type EnterFeynmanInput = z.infer<typeof enterFeynmanInputSchema>;
export type LearnerState = z.infer<typeof learnerStateSchema>;
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;
export type WebSource = NonNullable<MessageMetadata["webSources"]>[number];
export type DiagnosticQuestion = z.infer<typeof diagnosticQuestionSchema>;
export type CoachTurn = z.infer<typeof coachTurnSchema>;
export type ReportDimension = z.infer<typeof reportDimensionSchema>;
export type ReportDimensions = z.infer<typeof reportDimensionsSchema>;
export type Strengths = z.infer<typeof strengthsSchema>;
export type ReportGap = z.infer<typeof reportGapSchema>;
export type ReportGaps = z.infer<typeof reportGapsSchema>;
export type NextSteps = z.infer<typeof nextStepsSchema>;
export type LearningReportDraft = z.infer<typeof learningReportDraftSchema>;

export interface MessageDTO {
  id: string;
  role: MessageRole;
  phase: LearningPhase;
  content: string;
  questionType: QuestionType | null;
  clientRequestId: string | null;
  webSources: WebSource[];
  knowledgePolicy: MessageMetadata["knowledgePolicy"] | null;
  createdAt: string;
}

export interface LearningSessionDTO {
  knowledgeProgress?: { pedagogicalStage: import("./knowledge/v12-schema").V12State["pedagogicalStage"]; diagnosticLevel: string | null; experienceLimitReached: boolean; resumeVerification?: boolean; resumeRequired?: boolean };
  id: string;
  course: string | null;
  chapter: string | null;
  topic: string;
  objective: string;
  learnerLevel: string;
  hasReferenceMaterial: boolean;
  phase: LearningPhase;
  socraticTurns: number;
  maxTurns: number;
  parentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningReportDTO {
  evidenceAudit?: import("./knowledge/v12-schema").V12State | null;
  evidenceLinks?: import("./knowledge/report-evidence").ReportEvidenceLinks | null;
  sessionVersions?: import("./knowledge/runtime-schemas").SessionVersions | null;
  id: string;
  sessionId: string;
  summary: string;
  overallScore: number;
  overallLevel: string;
  dimensions: ReportDimensions;
  strengths: Strengths;
  gaps: ReportGaps;
  nextSteps: NextSteps;
  disclaimer: string;
  createdAt: string;
}

export interface SessionPayload {
  availableActions?: { canRequestHint: boolean; canEnterFeynman: boolean };
  session: LearningSessionDTO;
  messages: MessageDTO[];
  report: LearningReportDTO | null;
}

export type ApiSuccess<T> = {
  data: T;
  requestId: string;
};

export type ApiFailure = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  requestId: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const isApiFailure = <T>(response: ApiResponse<T>): response is ApiFailure =>
  "error" in response;
