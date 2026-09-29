import type { z } from "zod";
import { AIProviderError } from "../errors";
import { teachingReviewSchema, type TeachingOutput, type TeachingSelection } from "./teaching-schema";

export function assertTeachingReview(input: TeachingSelection, candidate: TeachingOutput["followUp"], review: z.infer<typeof teachingReviewSchema>): void {
  const fail = () => { throw new AIProviderError("AI_INVALID_OUTPUT", "追问未通过知识边界与教学针对性复核，请重试。", 502, true); };
  if (!candidate || !input.grounding) return fail();
  const { requiredAll, requiredAny } = input.grounding.requirements;
  const expected = new Set([...requiredAll, ...requiredAny]);
  const checks = new Map(review.requirementChecks.map((item) => [item.evidenceId, item]));
  if (checks.size !== review.requirementChecks.length || checks.size !== expected.size || [...checks.keys()].some((id) => !expected.has(id))) return fail();
  for (const check of checks.values()) {
    if (check.questionQuote !== null && !candidate.question.includes(check.questionQuote)) return fail();
    if (check.status !== "NOT_ASKED" && check.questionQuote === null) return fail();
  }
  const elicited = (id: string) => checks.get(id)?.status === "ELICITED";
  // A premise may be valid course knowledge and still supply the very conclusion
  // this particular question is supposed to elicit. It is not target coverage.
  if (!requiredAll.every(elicited) || (requiredAny.length > 0 && !requiredAny.some(elicited))) return fail();
  if (review.answerLeakQuote !== null || review.missingInformation !== null) return fail();
  if (![review.grounded, review.targetAligned, review.answerConnected, review.nonRedundant, review.noAnswerLeak, review.questionAnswerable].every(Boolean)) return fail();
}
