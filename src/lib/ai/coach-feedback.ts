import { AIProviderError } from "../errors";
import { z } from "zod";
import { learningFeedbackSchema, type LearningFeedback } from "../learning-feedback";

export const coachPrerequisiteEvidenceSchema = z.object({
  fact: z.string().trim().min(1).max(240),
  kind: z.enum(["READING_ARITHMETIC", "DOMAIN_RULE"]),
  source: z.enum(["STUDENT", "REFERENCE", "QUESTION", "BASIC_OPERATION", "UNSUPPORTED"]),
  quote: z.string().trim().min(1).max(240).nullable(),
}).strict();
export type CoachPrerequisiteEvidence = z.infer<typeof coachPrerequisiteEvidenceSchema>;

// An internal, compact account of a conditional inference, not student metadata.
// The model checks source meaning; this gate checks its declared logical direction.
export const coachConditionalCheckSchema = z.object({
  questionTarget: z.enum(["RULE_APPLICABILITY", "CONCLUSION_TRUTH", "AMBIGUOUS"]),
  questionQuote: z.string().trim().min(1).max(240),
  ruleIndex: z.number().int().min(0).max(3),
  inference: z.enum(["P_TO_Q", "NOT_Q_TO_NOT_P", "NOT_P_TO_NOT_Q", "Q_TO_P", "APPLICATION_ONLY"]),
  additionalRuleIndices: z.array(z.number().int().min(0).max(3)).max(3),
}).strict();
export type CoachConditionalCheck = z.infer<typeof coachConditionalCheckSchema>;

export function validateCoachConditionalReasoning(
  question: string,
  check: CoachConditionalCheck | null,
  prerequisites: readonly CoachPrerequisiteEvidence[],
): "questionAnswerable" | "prerequisitesSupported" | null {
  if (check === null) return null;
  if (check.questionTarget === "AMBIGUOUS" || !question.includes(check.questionQuote)) return "questionAnswerable";
  if (check.questionTarget === "CONCLUSION_TRUTH" && check.inference === "APPLICATION_ONLY") return "questionAnswerable";

  const supportedRule = (item: CoachPrerequisiteEvidence | undefined): item is CoachPrerequisiteEvidence => Boolean(
    item && item.kind === "DOMAIN_RULE" && item.source !== "UNSUPPORTED" && item.source !== "BASIC_OPERATION" && item.quote?.trim(),
  );
  const rule = prerequisites[check.ruleIndex];
  if (!supportedRule(rule)) return "prerequisitesSupported";
  const indices = check.additionalRuleIndices;
  if (new Set(indices).size !== indices.length || indices.some((index) => {
    const additional = prerequisites[index];
    return index === check.ruleIndex || !supportedRule(additional) || additional.fact === rule.fact;
  })) return "prerequisitesSupported";
  // A single biconditional citation can support two different rule facts. Do not
  // require distinct quote text, but copying the forward fact is not extra support.
  if ((check.inference === "NOT_P_TO_NOT_Q" || check.inference === "Q_TO_P") && indices.length === 0) return "prerequisitesSupported";
  return null;
}

// Validate again at the write boundary; a custom provider cannot bypass grounding.
export function requireAnswerFeedback(value: unknown, latestAnswer: string, previousStudentAnswers: readonly string[] = []): LearningFeedback {
  const parsed = learningFeedbackSchema.safeParse(value);
  if (!parsed.success || !latestAnswer.includes(parsed.data.answerQuote)) {
    throw new AIProviderError("AI_INVALID_OUTPUT", "学习反馈未能对应你刚才的回答，请重试。", 502, true);
  }
  if (parsed.data.progress !== null && !previousStudentAnswers.some((answer) => answer.trim() && answer !== latestAnswer)) {
    throw new AIProviderError("AI_INVALID_OUTPUT", "尚无前后两次作答可支持理解变化，请重新生成反馈。", 502, true);
  }
  return parsed.data;
}
