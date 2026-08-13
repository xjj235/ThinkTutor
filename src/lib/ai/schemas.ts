import { z } from "zod";

export const feynmanInstructionSchema = z
  .object({
    assistantMessage: z.string().trim().min(1).max(600),
    requirements: z.array(z.string().trim().min(1).max(160)).min(3).max(6),
  })
  .strict();

export const retryTaskSchema = z
  .object({
    topic: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(10).max(600),
    rationale: z.string().trim().min(1).max(400),
  })
  .strict();

export const learningContextSummarySchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    confirmedPoints: z.array(z.string().trim().min(1).max(180)).max(8),
    gaps: z.array(z.string().trim().min(1).max(180)).max(8),
    misconceptions: z.array(z.string().trim().min(1).max(180)).max(8),
  })
  .strict();

export const materialKeywordsSchema = z
  .object({ keywords: z.array(z.string().trim().min(1).max(60)).min(3).max(20) })
  .strict();

export type FeynmanInstruction = z.infer<typeof feynmanInstructionSchema>;
export type RetryTask = z.infer<typeof retryTaskSchema>;
export type LearningContextSummary = z.infer<typeof learningContextSummarySchema>;
export type MaterialKeywords = z.infer<typeof materialKeywordsSchema>;
