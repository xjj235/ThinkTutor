import type { CoachNextAction, LearnerState, LearningPhase, QuestionType } from "./contracts";
import { MAX_SOCRATIC_TURNS, MIN_SOCRATIC_TURNS } from "./contracts";
import type { V12State } from "./knowledge/v12-schema";

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
    throw new Error(`maxTurns must be between ${MIN_SOCRATIC_TURNS} and ${MAX_SOCRATIC_TURNS}.`);
  }
  if (session.socraticTurns > session.maxTurns) throw new Error("socraticTurns exceeds maxTurns.");
}

const unknownStatement = /^(?:(?:我|我们|这题|这道题|这里|目前|暂时|还|也|完全|真的|确实|实在|还是)\s*)*(?:不知道|不清楚|不懂|不太懂|不明白|不会|没思路|没有思路)(?:(?:该|要|应该)?(?:怎么|如何)(?:回答|解释|分析|做|说)(?:这个问题|这道题)?|这个(?:概念|问题|知识点)|这道题)?[啊呀呢哦了吧]*$/u;
const unknownEnglishStatement = /^(?:(?:i|we)\s+)?(?:(?:do\s+not|don't|dont)\s+(?:know|understand)|have\s+no\s+idea|no\s+idea|idk|unsure)(?:\s+(?:yet|how\s+to\s+(?:answer|explain|start)))?$/u;
const helpRequest = /^(?:(?:请|能|可以|能否|可否)\s*)?(?:(?:给|提供)(?:我)?(?:个|一点|一些)?(?:提示|线索|帮助)|提示一下)(?:吗|么|吧)?$/u;

export function isLowInformationAnswer(answer: string): boolean {
  const normalized = answer.normalize("NFKC").trim().toLowerCase().replace(/’/gu, "'");
  if (!/[\p{L}\p{N}]/u.test(normalized)) return true;
  const clauses = normalized.split(/[，,。.!！?？;；\r\n]+/u).map((clause) => clause.trim()).filter(Boolean);
  // A short concept or a sentence containing “不会” can be substantive. Only
  // explicit unknown/help statements qualify; a mixed answer retains evidence.
  return clauses.length > 0 && clauses.every((clause) => unknownStatement.test(clause) || unknownEnglishStatement.test(clause) || helpRequest.test(clause));
}

export interface LearningEvidenceMessage {
  role: string;
  phase: LearningPhase;
  content: string;
  questionType: QuestionType | null;
}

export function answeredSocraticQuestionTypes(messages: readonly LearningEvidenceMessage[]): QuestionType[] {
  const answered: QuestionType[] = [];
  let pending: QuestionType | null = null;
  for (const message of messages) {
    if (message.phase !== "SOCRATIC") continue;
    if (message.role === "ASSISTANT" && message.questionType && message.questionType !== "SCAFFOLDED_HINT") {
      pending = message.questionType;
    } else if (message.role === "USER" && pending && !isLowInformationAnswer(message.content)) {
      answered.push(pending);
      pending = null;
    }
  }
  return answered;
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

export function nextV12Transition(session: SessionStateSnapshot, evidence: {
  stage: V12State["pedagogicalStage"]; diagnosisFinished: boolean; constructionReady: boolean; transferPassed: boolean; majorError: boolean; verificationRequired?: boolean;
}): StateTransition & { stage: V12State["pedagogicalStage"]; experienceLimitReached: boolean; reasonCode: V12State["stageTransitions"][number]["reasonCode"] | null } {
  assertValidSnapshot(session);
  if (evidence.verificationRequired) {
    if (!["DIAGNOSIS", "SOCRATIC", "FEYNMAN"].includes(session.phase)) throw new Error("Cannot verify a terminal session");
    return { phase: session.phase, stage: evidence.stage, socraticTurns: session.socraticTurns, forceFeynman: false, experienceLimitReached: false, reasonCode: null };
  }
  let phase = session.phase;
  let stage = evidence.stage;
  let turns = session.socraticTurns;
  let experienceLimitReached = false;
  let reasonCode: V12State["stageTransitions"][number]["reasonCode"] | null = null;
  if (phase === "DIAGNOSIS") {
    if (stage !== "DIAGNOSIS") throw new Error("Invalid diagnostic stage");
    if (evidence.diagnosisFinished) { phase = "SOCRATIC"; stage = evidence.constructionReady ? "CASE_TRANSFER" : "KNOWLEDGE_CONSTRUCTION"; reasonCode = "DIAGNOSIS_STABLE"; }
  } else if (phase === "SOCRATIC") {
    if (!["KNOWLEDGE_CONSTRUCTION", "CASE_TRANSFER"].includes(stage) || turns >= session.maxTurns) throw new Error("Invalid construction transition");
    turns += 1;
    if (stage === "CASE_TRANSFER" && evidence.transferPassed && turns >= MIN_SOCRATIC_TURNS) { phase = "FEYNMAN"; stage = "FEYNMAN_OUTPUT"; reasonCode = "CASE_PASSED"; }
    else if (turns >= session.maxTurns) { phase = "FEYNMAN"; stage = "REFLECTION"; experienceLimitReached = true; reasonCode = "EXPERIENCE_LIMIT"; }
    else { stage = evidence.constructionReady && (stage !== "CASE_TRANSFER" || evidence.transferPassed) ? "CASE_TRANSFER" : "KNOWLEDGE_CONSTRUCTION"; if (stage !== evidence.stage) reasonCode = stage === "CASE_TRANSFER" ? "CONSTRUCTION_CRITERIA_MET" : "CASE_REPAIR_REQUIRED"; }
  } else if (phase === "FEYNMAN") {
    if (stage === "FEYNMAN_OUTPUT") {
      if (evidence.majorError && turns < session.maxTurns) { phase = "SOCRATIC"; stage = "KNOWLEDGE_CONSTRUCTION"; reasonCode = "FEYNMAN_MAJOR_BACKTRACK"; }
      else { stage = "REFLECTION"; reasonCode = "FEYNMAN_COMPLETED"; }
    } else if (stage === "REFLECTION") { phase = "REPORTING"; stage = "REPORT"; reasonCode = "REFLECTION_COMPLETED"; }
    else throw new Error("Invalid explanation stage");
  } else throw new Error("Cannot answer in terminal phase");
  return { phase, stage, socraticTurns: turns, forceFeynman: false, experienceLimitReached, reasonCode };
}

export function recordStageTransition(state: V12State, toStage: V12State["pedagogicalStage"], reasonCode: V12State["stageTransitions"][number]["reasonCode"], now: string, evidenceRefs: V12State["stageTransitions"][number]["evidenceRefs"] = []): V12State {
  return { ...state, pedagogicalStage: toStage, stageTransitions: [...state.stageTransitions, { fromStage: reasonCode === "GOAL_PRESENTED" ? null : state.pedagogicalStage, toStage, reasonCode, evidenceRefs, actor: "SYSTEM", createdAt: now }] };
}

export function presentV12Goal(state: V12State, now: string): V12State {
  if (state.assessments && Object.keys(state.assessments).length) throw new Error("Cannot present a new goal after assessment");
  return { ...recordStageTransition(state, "GOAL_PRESENTATION", "GOAL_PRESENTED", now), activityType: "GOAL_PRESENTATION", goalPresentedAt: now };
}

export function confirmV12Goal(session: SessionStateSnapshot, state: V12State, now: string): V12State {
  assertValidSnapshot(session);
  if (session.phase !== "DIAGNOSIS" || state.pedagogicalStage !== "GOAL_PRESENTATION" || !state.goalPresentedAt) throw new Error("No goal awaiting confirmation");
  return { ...recordStageTransition(state, "DIAGNOSIS", "GOAL_CONFIRMED", now), activityType: "DIAGNOSTIC_QUESTION", goalConfirmedAt: now };
}

export function resumeV12State(session: SessionStateSnapshot, state: V12State, context: NonNullable<V12State["resumeVerification"]>, now: string): V12State {
  assertValidSnapshot(session);
  if (!["DIAGNOSIS", "SOCRATIC", "FEYNMAN"].includes(session.phase) || state.pedagogicalStage === "GOAL_PRESENTATION" || state.resumeVerification) throw new Error("Session cannot begin resume verification");
  return { ...recordStageTransition(state, state.pedagogicalStage, "SESSION_RESUMED", now), resumeVerification: context, activityType: "VERIFY" };
}

export function finishV12Resume(session: SessionStateSnapshot, state: V12State, now: string, refs: V12State["stageTransitions"][number]["evidenceRefs"]): V12State {
  assertValidSnapshot(session);
  const saved = state.resumeVerification;
  if (!saved) throw new Error("No resume verification");
  if (state.lastResult === "NEED_VERIFY") return state;
  // A failed short check preserves the original task; the new gap is retained for repair.
  return { ...recordStageTransition(state, saved.stage, state.lastResult === "PASS" ? "RESUMED_REVERIFIED" : "RESUME_GAP_IDENTIFIED", now, refs), activityType: saved.activityType, resumeVerification: null };
}
