import { z } from "zod";

// Student-facing feedback is persisted with the answer it actually evaluates.
// Optional use on historical messages keeps old learning records readable.
export const learningFeedbackSchema = z.object({
  answerQuote: z.string().trim().min(1).max(240),
  observation: z.string().trim().min(1).max(240),
  focus: z.string().trim().min(1).max(180),
  whyItMatters: z.string().trim().min(1).max(240),
  progress: z.string().trim().min(1).max(240).nullable(),
}).strict();

export type LearningFeedback = z.infer<typeof learningFeedbackSchema>;
