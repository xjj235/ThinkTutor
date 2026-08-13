import type { CoachNextAction, LearnerState, LearningPhase, QuestionType } from "./contracts";
import { MAX_SOCRATIC_TURNS, MIN_SOCRATIC_TURNS } from "./contracts";

export interface SessionStateSnapshot {
  phase: LearningPhase;
  socraticTurns: number;
  maxTurns: number;
}

export interface StateTransition {
  phase: LearningPhase;
  socraticTurns: number;
  forceFeynman: boolean;
}

export interface FeynmanReadinessEvidence {
  answeredQuestionTypes: QuestionType[];
  learnerState: LearnerState | null;
}

function assertValidSnapshot(session: SessionStateSnapshot): void {
  if (!Number.isInteger(session.socraticTurns) || session.socraticTurns < 0) throw new Error("socraticTurns must be a non-negative integer.");
  if (!Number.isInteger(session.maxTurns) || session.maxTurns < MIN_SOCRATIC_TURNS || session.maxTurns > MAX_SOCRATIC_TURNS) {
    throw new Error("maxTurns must be between three and eight.");
  }
  if (session.socraticTurns > session.maxTurns) throw new Error("socraticTurns exceeds maxTurns.");
}

const unknownPatterns = ["不知道", "不清楚", "不会", "没思路", "没有思路", "不懂", "idk", "i don't know", "i do not know", "no idea"];

export function isLowInformationAnswer(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized.length < 6 || unknownPatterns.some((pattern) => normalized.includes(pattern));
}

export function computeUnknownStreak(answer: string, previousStreak: number): number {
  return isLowInformationAnswer(answer) ? Math.min(previousStreak + 1, 4) : 0;
}

export const canSubmitAnswer = (session: SessionStateSnapshot): boolean => session.phase === "DIAGNOSIS" || session.phase === "SOCRATIC";
export const canRequestHint = canSubmitAnswer;
export const canSubmitFeynman = (session: SessionStateSnapshot): boolean => session.phase === "FEYNMAN";
export const canRetrySession = (session: SessionStateSnapshot): boolean => session.phase === "COMPLETED";

export function hasFeynmanEvidence(session: SessionStateSnapshot, evidence: FeynmanReadinessEvidence): boolean {
  if (session.socraticTurns < MIN_SOCRATIC_TURNS) return false;
  const types = new Set(evidence.answeredQuestionTypes);
  const requiredCoverage = types.has("CONCEPT_CLARIFICATION") && types.has("CAUSE_PROBE") && types.has("EVIDENCE_PROBE");
  const hasThreeTypes = types.size >= 3;
  const hasLearnerEvidence = Boolean(
    evidence.learnerState &&
      (evidence.learnerState.confirmedPoints.length > 0 || evidence.learnerState.gaps.length > 0 || evidence.learnerState.misconceptions.length > 0),
  );
  return requiredCoverage && hasThreeTypes && hasLearnerEvidence;
}

export function canEnterFeynmanVoluntarily(session: SessionStateSnapshot, evidence?: FeynmanReadinessEvidence): boolean {
  return session.phase === "SOCRATIC" && session.socraticTurns >= MIN_SOCRATIC_TURNS && session.socraticTurns < session.maxTurns && (!evidence || hasFeynmanEvidence(session, evidence));
}

export function nextAfterDiagnosisAnswer(session: SessionStateSnapshot): StateTransition {
  assertValidSnapshot(session);
  if (session.phase !== "DIAGNOSIS" || session.socraticTurns !== 0) throw new Error("Diagnosis transition requires DIAGNOSIS phase at turn 0.");
  return { phase: "SOCRATIC", socraticTurns: 0, forceFeynman: false };
}

export function nextAfterSocraticAnswer(
  session: SessionStateSnapshot,
  nextAction: CoachNextAction,
  evidence?: FeynmanReadinessEvidence,
): StateTransition {
  assertValidSnapshot(session);
  if (session.phase !== "SOCRATIC") throw new Error("Socratic transition requires SOCRATIC phase.");
  if (session.socraticTurns >= session.maxTurns) throw new Error("Socratic transition cannot exceed maxTurns.");
  const completedTurns = session.socraticTurns + 1;
  if (completedTurns >= session.maxTurns) return { phase: "FEYNMAN", socraticTurns: session.maxTurns, forceFeynman: true };
  const completedSnapshot = { ...session, socraticTurns: completedTurns };
  if (nextAction === "REQUEST_FEYNMAN" && canEnterFeynmanVoluntarily(completedSnapshot, evidence)) {
    return { phase: "FEYNMAN", socraticTurns: completedTurns, forceFeynman: false };
  }
  return { phase: "SOCRATIC", socraticTurns: completedTurns, forceFeynman: false };
}

export function enterFeynmanVoluntarily(session: SessionStateSnapshot, evidence?: FeynmanReadinessEvidence): StateTransition {
  assertValidSnapshot(session);
  if (!canEnterFeynmanVoluntarily(session, evidence)) throw new Error("Voluntary Feynman transition requires sufficient Socratic evidence.");
  return { phase: "FEYNMAN", socraticTurns: session.socraticTurns, forceFeynman: false };
}

export function nextAfterFeynman(session: SessionStateSnapshot): StateTransition {
  assertValidSnapshot(session);
  if (session.phase !== "FEYNMAN") throw new Error("Feynman transition requires FEYNMAN phase.");
  return { phase: "REPORTING", socraticTurns: session.socraticTurns, forceFeynman: false };
}

export function nextAfterReportSaved(session: SessionStateSnapshot): StateTransition {
  assertValidSnapshot(session);
  if (session.phase !== "REPORTING") throw new Error("Report completion requires REPORTING phase.");
  return { phase: "COMPLETED", socraticTurns: session.socraticTurns, forceFeynman: false };
}

export function abandonSession(session: SessionStateSnapshot): StateTransition {
  assertValidSnapshot(session);
  if (session.phase === "COMPLETED" || session.phase === "ABANDONED") throw new Error("Terminal sessions cannot be abandoned again.");
  return { phase: "ABANDONED", socraticTurns: session.socraticTurns, forceFeynman: false };
}
