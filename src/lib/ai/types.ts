import type {
  CoachTurn,
  CreateSessionInput,
  DiagnosticQuestion,
  LearnerState,
  LearningPhase,
  LearningReportDraft,
  MessageDTO,
  ReportGap,
  WebSource,
} from "../contracts";
import type { FeynmanInstruction, LearningContextSummary, MaterialKeywords, RetryTask } from "./schemas";
import type { KnowledgePolicy } from "./context-builder";

export interface AIRequestMeta {
  userId?: string;
  sessionId?: string;
  requestId?: string;
}

export interface DiagnosticInput extends AIRequestMeta {
  task: CreateSessionInput;
  retrievedContext?: string[];
  knowledgePolicy?: KnowledgePolicy;
}
export type SourcedDiagnosticQuestion = DiagnosticQuestion & { webSources?: WebSource[]; knowledgePolicy?: KnowledgePolicy | "WEB_SEARCH_FALLBACK" };
export type SourcedCoachTurn = CoachTurn & { webSources?: WebSource[]; knowledgePolicy?: KnowledgePolicy | "WEB_SEARCH_FALLBACK" };
export interface CoachTurnInput extends AIRequestMeta {
  selectedAction?: import("../knowledge/orchestrator").KnowledgeAction;
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
  knowledgePolicy?: KnowledgePolicy;
}
export interface ReportInput extends AIRequestMeta {
  retrievedContext?: string[];
  task: CreateSessionInput;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
  feynmanExplanation: string;
}
export interface FeynmanInstructionInput extends AIRequestMeta { task: CreateSessionInput; learnerState: LearnerState | null; }
export interface RetryTaskInput extends AIRequestMeta { task: CreateSessionInput; gap: ReportGap; }
export interface ContextSummaryInput extends AIRequestMeta { task: CreateSessionInput; messages: Pick<MessageDTO, "role" | "content">[]; }
export interface MaterialKeywordsInput extends AIRequestMeta { title: string; content: string; }
export interface TurnAssessmentInput extends AIRequestMeta {
  evaluationRules?: Record<string, import("../knowledge/v12-schema").EvidenceRule>;
  candidateTargets: import("./assessment-schema").AssessmentCandidateTargets;
  message: { id: string; content: string };
  lockedContext: { phase: string; stage: string; targetId: string | null; questionId: string | null; caseId: string | null; action: "ASSESS_EVIDENCE"; hintLevel: number; releaseId: string; questionText?: string; caseContext?: string };
  evidenceDefinitions: Record<string, string>;
  knowledgeUnits: Array<{ id: string; content: string }>;
  aliases: Record<string, { accepted: string[]; forbidden: string[] }>;
}

export interface AIProvider {
  selectTeachingMove(input: import("./teaching-schema").TeachingSelection & AIRequestMeta): Promise<import("../knowledge/coaching-schema").CoachingDecision>;
  assessLearningTurn(input: TurnAssessmentInput): Promise<import("../knowledge/v12-schema").TurnAssessment>;
  createDiagnosticQuestion(input: DiagnosticInput): Promise<SourcedDiagnosticQuestion>;
  createCoachTurn(input: CoachTurnInput): Promise<SourcedCoachTurn>;
  createFeynmanInstruction(input: FeynmanInstructionInput): Promise<FeynmanInstruction>;
  createLearningReport(input: ReportInput): Promise<LearningReportDraft>;
  createRetryTask(input: RetryTaskInput): Promise<RetryTask>;
  summarizeLearningContext(input: ContextSummaryInput): Promise<LearningContextSummary>;
  createMaterialKeywords(input: MaterialKeywordsInput): Promise<MaterialKeywords>;
}
