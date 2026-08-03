import {
  DimensionKey,
  LearningReportDraft,
  ReportDimension,
  dimensionKeys,
  reportDisclaimer,
} from "./contracts";

export function computeOverallScore(scores: number[]) {
  if (scores.length !== 5) {
    throw new Error("Overall score requires exactly five dimensions.");
  }

  const total = scores.reduce((sum, score) => sum + score, 0);
  return Math.round(total / scores.length);
}

export function finalizeReportDraft(draft: LearningReportDraft) {
  const scores = dimensionKeys.map((key) => draft.dimensions[key].score);
  return {
    ...draft,
    overallScore: computeOverallScore(scores),
    disclaimer: reportDisclaimer,
  };
}

export function getLowestDimension(
  dimensions: Record<DimensionKey, ReportDimension>,
) {
  return dimensionKeys.reduce((lowest, key) => {
    return dimensions[key].score < dimensions[lowest].score ? key : lowest;
  }, dimensionKeys[0]);
}
