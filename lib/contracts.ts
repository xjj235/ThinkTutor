import { z } from "zod";

export const learningPhaseValues = [
  "DIAGNOSIS",
  "SOCRATIC",
  "FEYNMAN",
  "COMPLETED",
] as const;

export const messageRoleValues = ["USER", "ASSISTANT", "SYSTEM_EVENT"] as const;

export const questionTypeValues = [
  "CONCEPT_CLARIFICATION",
  "CAUSE_PROBE",
  "ASSUMPTION_TEST",
  "COUNTEREXAMPLE",
  "TRANSFER",
  "SCAFFOLDED_HINT",
] as const;

export const coachSuggestionValues = ["CONTINUE", "REQUEST_FEYNMAN"] as const;

export const dimensionKeys = [
  "conceptCompleteness",
  "logicCompleteness",
  "expressionClarity",
  "exampleAbility",
  "transferAbility",
] as const;

export const phaseLabels: Record<LearningPhase, string> = {
  DIAGNOSIS: "知识诊断",
  SOCRATIC: "苏格拉底追问",
  FEYNMAN: "费曼讲解",
  COMPLETED: "学习报告",
};

export const questionTypeLabels: Record<QuestionType, string> = {
  CONCEPT_CLARIFICATION: "概念澄清",
  CAUSE_PROBE: "原因追问",
  ASSUMPTION_TEST: "假设检验",
  COUNTEREXAMPLE: "反例思考",
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

export const MAX_MESSAGES_PER_SESSION = 80;
export const MAX_SOCRATIC_ROUNDS = 5;
export const MIN_SOCRATIC_ROUNDS = 3;

export const textLimits = {
  course: 80,
  chapter: 120,
  topic: 120,
  goal: 400,
  learnerLevel: 80,
  referenceText: 6000,
  answer: 2000,
  feynmanExplanation: 4000,
  clientRequestId: 80,
} as const;

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));

export const createSessionInputSchema = z
  .object({
    course: optionalTrimmed(textLimits.course),
    chapter: optionalTrimmed(textLimits.chapter),
    topic: z.string().trim().min(1).max(textLimits.topic),
    goal: z.string().trim().min(1).max(textLimits.goal),
    learnerLevel: z.string().trim().min(1).max(textLimits.learnerLevel),
    referenceText: optionalTrimmed(textLimits.referenceText),
  })
  .strict();

export const answerInputSchema = z
  .object({
    answer: z.string().trim().min(1).max(textLimits.answer),
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
    explanation: z.string().trim().min(20).max(textLimits.feynmanExplanation),
    clientRequestId: z.string().trim().min(8).max(textLimits.clientRequestId),
  })
  .strict();

export const retryInputSchema = z
  .object({
    clientRequestId: z
      .string()
      .trim()
      .min(8)
      .max(textLimits.clientRequestId),
  })
  .strict();

export const sessionIdSchema = z.string().trim().min(1).max(64);

export const learningPhaseSchema = z.enum(learningPhaseValues);
export const messageRoleSchema = z.enum(messageRoleValues);
export const questionTypeSchema = z.enum(questionTypeValues);
export const coachSuggestionSchema = z.enum(coachSuggestionValues);

export const diagnosticQuestionSchema = z
  .object({
    question: z.string().trim().min(10).max(600),
    questionType: questionTypeSchema.default("CONCEPT_CLARIFICATION"),
  })
  .strict();

export const coachTurnSchema = z
  .object({
    question: z.string().trim().min(10).max(700),
    questionType: questionTypeSchema,
    suggestion: coachSuggestionSchema,
  })
  .strict();

export const reportDimensionSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    evidence: z.string().trim().min(1).max(800),
    feedback: z.string().trim().min(1).max(800),
  })
  .strict();

export const learningReportDraftSchema = z
  .object({
    summary: z.string().trim().min(1).max(1200),
    dimensions: z
      .object({
        conceptCompleteness: reportDimensionSchema,
        logicCompleteness: reportDimensionSchema,
        expressionClarity: reportDimensionSchema,
        exampleAbility: reportDimensionSchema,
        transferAbility: reportDimensionSchema,
      })
      .strict(),
    mastered: z.array(z.string().trim().min(1).max(180)).max(8),
    gaps: z.array(z.string().trim().min(1).max(180)).min(1).max(8),
    nextSteps: z.array(z.string().trim().min(1).max(220)).max(3),
  })
  .strict();

export const reportDisclaimer =
  "本报告仅依据本次学习对话生成，属于形成性学习反馈，不代表标准化能力测评结果。";

export type LearningPhase = (typeof learningPhaseValues)[number];
export type MessageRole = (typeof messageRoleValues)[number];
export type QuestionType = (typeof questionTypeValues)[number];
export type CoachSuggestion = (typeof coachSuggestionValues)[number];
export type DimensionKey = (typeof dimensionKeys)[number];

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type AnswerInput = z.infer<typeof answerInputSchema>;
export type HintInput = z.infer<typeof hintInputSchema>;
export type FeynmanInput = z.infer<typeof feynmanInputSchema>;
export type RetryInput = z.infer<typeof retryInputSchema>;
export type DiagnosticQuestion = z.infer<typeof diagnosticQuestionSchema>;
export type CoachTurn = z.infer<typeof coachTurnSchema>;
export type ReportDimension = z.infer<typeof reportDimensionSchema>;
export type LearningReportDraft = z.infer<typeof learningReportDraftSchema>;

export interface MessageDTO {
  id: string;
  role: MessageRole;
  phase: LearningPhase;
  content: string;
  questionType: QuestionType | null;
  clientRequestId: string | null;
  createdAt: string;
}

export interface LearningSessionDTO {
  id: string;
  course: string | null;
  chapter: string | null;
  topic: string;
  goal: string;
  learnerLevel: string;
  referenceText: string | null;
  phase: LearningPhase;
  socraticRound: number;
  unknownStreak: number;
  feynmanExplanation: string | null;
  parentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningReportDTO {
  id: string;
  sessionId: string;
  summary: string;
  dimensions: Record<DimensionKey, ReportDimension>;
  mastered: string[];
  gaps: string[];
  nextSteps: string[];
  scores: {
    conceptScore: number;
    logicScore: number;
    clarityScore: number;
    exampleScore: number;
    transferScore: number;
    overallScore: number;
  };
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionPayload {
  session: LearningSessionDTO;
  messages: MessageDTO[];
  report: LearningReportDTO | null;
}

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
