import {
  DimensionKey,
  LearningReportDraft,
  ReportGap,
  ReportDimension,
  dimensionKeys,
  reportDisclaimer,
} from "./contracts";
import type { KnowledgeRuntime } from "./knowledge/runtime-schemas";

export function computeOverallScore(scores: number[]) {
  if (scores.length !== 5) {
    throw new Error("Overall score requires exactly five dimensions.");
  }
  if (
    scores.some(
      (score) => !Number.isInteger(score) || score < 0 || score > 100,
    )
  ) {
    throw new Error("Dimension scores must be integers from 0 to 100.");
  }

  const total = scores.reduce((sum, score) => sum + score, 0);
  return Math.round(total / scores.length);
}

export function finalizeReportDraft(draft: LearningReportDraft, runtime?: KnowledgeRuntime) {
  if (runtime) {
    draft = structuredClone(draft);
    const needsVerification = runtime.flags.includes("FLAG_NEED_VERIFY");
    for (const key of dimensionKeys) {
      const dimension = draft.dimensions[key];
      // The UI uses /100; each 5/20 rubric step maps to 25/100.
      const cap = needsVerification && key !== "expressionClarity" ? 75 : 100;
      dimension.score = Math.min(cap, Math.floor(dimension.score / 25) * 25);
      if (cap < 100) dimension.feedback = `${dimension.feedback.slice(0, 340)} 本次存在提示依赖或待核验证据，暂不评为最高档。`;
    }
    draft.overallLevel = "五档形成性评价";
  }
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

export function getHighestPriorityGap(gaps: ReportGap[]): ReportGap | null {
  if (gaps.length === 0) {
    return null;
  }

  return gaps.reduce((highest, gap) =>
    gap.priority > highest.priority ? gap : highest,
  );
}
