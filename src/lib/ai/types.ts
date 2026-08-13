import type {
  CoachTurn,
  CreateSessionInput,
  DiagnosticQuestion,
  LearnerState,
  LearningPhase,
  LearningReportDraft,
  MessageDTO,
  ReportGap,
} from "../contracts";
import type { FeynmanInstruction, LearningContextSummary, MaterialKeywords, RetryTask } from "./schemas";

export interface AIRequestMeta {
  userId?: string;
  sessionId?: string;
  requestId?: string;
}

export interface DiagnosticInput extends AIRequestMeta { task: CreateSessionInput; }
export interface CoachTurnInput extends AIRequestMeta {
  task: CreateSessionInput;
  phase: LearningPhase;
  socraticTurns: number;
  maxTurns: number;
  unknownStreak: number;
  learnerState: LearnerState | null;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
  latestAnswer?: string;
  isHintRequest?: boolean;
  contextSummary?: string | null;
  retrievedContext?: string[];
}
export interface ReportInput extends AIRequestMeta {
  task: CreateSessionInput;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
  feynmanExplanation: string;
}
export interface FeynmanInstructionInput extends AIRequestMeta { task: CreateSessionInput; learnerState: LearnerState | null; }
export interface RetryTaskInput extends AIRequestMeta { task: CreateSessionInput; gap: ReportGap; }
export interface ContextSummaryInput extends AIRequestMeta { task: CreateSessionInput; messages: Pick<MessageDTO, "role" | "content">[]; }
export interface MaterialKeywordsInput extends AIRequestMeta { title: string; content: string; }

export interface AIProvider {
  createDiagnosticQuestion(input: DiagnosticInput): Promise<DiagnosticQuestion>;
  createCoachTurn(input: CoachTurnInput): Promise<CoachTurn>;
  createFeynmanInstruction(input: FeynmanInstructionInput): Promise<FeynmanInstruction>;
  createLearningReport(input: ReportInput): Promise<LearningReportDraft>;
  createRetryTask(input: RetryTaskInput): Promise<RetryTask>;
  summarizeLearningContext(input: ContextSummaryInput): Promise<LearningContextSummary>;
  createMaterialKeywords(input: MaterialKeywordsInput): Promise<MaterialKeywords>;
}
