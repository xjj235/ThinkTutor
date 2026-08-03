import {
  CoachTurn,
  CreateSessionInput,
  DiagnosticQuestion,
  LearningPhase,
  LearningReportDraft,
  MessageDTO,
} from "../contracts";

export interface DiagnosticInput {
  task: CreateSessionInput;
}

export interface CoachTurnInput {
  task: CreateSessionInput;
  phase: LearningPhase;
  socraticRound: number;
  unknownStreak: number;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
  latestAnswer?: string;
  isHintRequest?: boolean;
}

export interface ReportInput {
  task: CreateSessionInput;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
  feynmanExplanation: string;
}

export interface AIProvider {
  createDiagnosticQuestion(input: DiagnosticInput): Promise<DiagnosticQuestion>;
  createCoachTurn(input: CoachTurnInput): Promise<CoachTurn>;
  createLearningReport(input: ReportInput): Promise<LearningReportDraft>;
}
