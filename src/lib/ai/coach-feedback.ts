import { AIProviderError } from "../errors";
import { learningFeedbackSchema, type LearningFeedback } from "../learning-feedback";

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
