import type { SourcedDiagnosticQuestion } from "./types";
export { assertDiagnosticReview, diagnosticReviewPrompt, diagnosticReviewSchema, type DiagnosticReview } from "./diagnostic-review";

/** Creating a task supplies no student answer; even well-formed model state is unobserved. */
export function normalizeInitialDiagnostic(candidate: SourcedDiagnosticQuestion): SourcedDiagnosticQuestion {
  const initial = { ...candidate };
  delete initial.learningFeedback;
  return {
    ...initial,
    learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] },
    transitionReason: "首次提问，等待学生作答后再判断理解。",
  };
}
