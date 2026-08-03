import {
  LearningPhase,
  MAX_SOCRATIC_ROUNDS,
  MIN_SOCRATIC_ROUNDS,
  CoachSuggestion,
} from "./contracts";

export interface SessionStateSnapshot {
  phase: LearningPhase;
  socraticRound: number;
  unknownStreak: number;
}

export interface StateTransition {
  phase: LearningPhase;
  socraticRound: number;
  forceFeynman: boolean;
}

const unknownPatterns = [
  "不知道",
  "不清楚",
  "不会",
  "没思路",
  "没有思路",
  "不懂",
  "idk",
  "i don't know",
  "i do not know",
  "no idea",
];

export function isLowInformationAnswer(answer: string) {
  const normalized = answer.trim().toLowerCase();
  if (normalized.length < 6) {
    return true;
  }
  return unknownPatterns.some((pattern) => normalized.includes(pattern));
}

export function computeUnknownStreak(answer: string, previousStreak: number) {
  return isLowInformationAnswer(answer) ? previousStreak + 1 : 0;
}

export function canSubmitAnswer(session: SessionStateSnapshot) {
  return session.phase === "DIAGNOSIS" || session.phase === "SOCRATIC";
}

export function canRequestHint(session: SessionStateSnapshot) {
  return session.phase === "DIAGNOSIS" || session.phase === "SOCRATIC";
}

export function canSubmitFeynman(session: SessionStateSnapshot) {
  return session.phase === "FEYNMAN";
}

export function canRetrySession(session: SessionStateSnapshot) {
  return session.phase === "COMPLETED";
}

export function nextAfterDiagnosisAnswer(): StateTransition {
  return {
    phase: "SOCRATIC",
    socraticRound: 0,
    forceFeynman: false,
  };
}

export function nextAfterSocraticAnswer(
  session: SessionStateSnapshot,
  suggestion: CoachSuggestion,
): StateTransition {
  if (session.phase !== "SOCRATIC") {
    throw new Error("Socratic transition requires SOCRATIC phase.");
  }

  const completedRound = session.socraticRound + 1;
  if (completedRound >= MAX_SOCRATIC_ROUNDS) {
    return {
      phase: "FEYNMAN",
      socraticRound: MAX_SOCRATIC_ROUNDS,
      forceFeynman: true,
    };
  }

  if (
    completedRound >= MIN_SOCRATIC_ROUNDS &&
    suggestion === "REQUEST_FEYNMAN"
  ) {
    return {
      phase: "FEYNMAN",
      socraticRound: completedRound,
      forceFeynman: false,
    };
  }

  return {
    phase: "SOCRATIC",
    socraticRound: completedRound,
    forceFeynman: false,
  };
}

export function nextAfterFeynman(): StateTransition {
  return {
    phase: "COMPLETED",
    socraticRound: MAX_SOCRATIC_ROUNDS,
    forceFeynman: false,
  };
}
