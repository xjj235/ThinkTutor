import { dimensionKeys, type LearningReportDraft } from "../contracts";
import { AIProviderError } from "../errors";

// This checks attribution, not the correctness of the model's interpretation.
export function assertReportGrounding(
  draft: LearningReportDraft,
  studentMessages: readonly string[],
): void {
  function check(evidence: string, quoteRequired: boolean): void {
    const quotePattern = /[“「"]([^”」"\r\n]{1,600})[”」"]/gu;
    const quotes = [...evidence.matchAll(quotePattern)].map((match) => match[1]);
    if ((quoteRequired && !quotes.some((quote) => quote.length >= 2))
      || /[“「”」"]/.test(evidence.replace(quotePattern, ""))
      || quotes.some((quote) => !studentMessages.some((message) => message.includes(quote)))) {
      throw new AIProviderError("AI_INVALID_OUTPUT", "报告证据未能对应学生原文，请重试。", 502, true);
    }
  }
  for (const key of dimensionKeys) {
    const dimension = draft.dimensions[key];
    check(dimension.evidence, dimension.score > 25);
    if (dimension.score <= 25 && !/[“「"]/.test(dimension.evidence)
      && !/未充分展示|证据不足|未提供|未体现|缺少.*证据|没有.*证据/u.test(dimension.evidence)) {
      throw new AIProviderError("AI_INVALID_OUTPUT", "报告需要说明证据不足的评价依据，请重试。", 502, true);
    }
  }
  for (const strength of draft.strengths) check(strength.evidence, true);
  // Quotations in evidence always mean student originals, regardless of the
  // model's attribution wording. Describe missing concepts and coach prompts
  // without quotation marks so they cannot be confused with student evidence.
  for (const gap of draft.gaps) check(gap.evidence, false);
}
