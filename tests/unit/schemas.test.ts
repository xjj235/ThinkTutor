import { describe, expect, it } from "vitest";
import {
  answerInputSchema,
  createSessionInputSchema,
  learningReportDraftSchema,
  sessionIdSchema,
  textLimits,
} from "@/lib/contracts";

describe("zod schemas", () => {
  it("validates a task creation payload", () => {
    const result = createSessionInputSchema.safeParse({
      course: "",
      chapter: "第一章",
      topic: "系统性风险",
      goal: "解释传染机制",
      learnerLevel: "有基础",
      referenceText: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.course).toBeUndefined();
      expect(result.data.referenceText).toBeUndefined();
    }
  });

  it("rejects overlong student answers", () => {
    const result = answerInputSchema.safeParse({
      answer: "a".repeat(textLimits.answer + 1),
      clientRequestId: "answer-123456",
    });

    expect(result.success).toBe(false);
  });

  it("validates dynamic session ids", () => {
    expect(sessionIdSchema.safeParse("session-123").success).toBe(true);
    expect(sessionIdSchema.safeParse("").success).toBe(false);
    expect(sessionIdSchema.safeParse("a".repeat(65)).success).toBe(false);
  });

  it("rejects model-generated overallScore in report drafts", () => {
    const result = learningReportDraftSchema.safeParse({
      summary: "summary",
      overallScore: 99,
      dimensions: {
        conceptCompleteness: {
          score: 80,
          evidence: "evidence",
          feedback: "feedback",
        },
        logicCompleteness: {
          score: 80,
          evidence: "evidence",
          feedback: "feedback",
        },
        expressionClarity: {
          score: 80,
          evidence: "evidence",
          feedback: "feedback",
        },
        exampleAbility: {
          score: 80,
          evidence: "evidence",
          feedback: "feedback",
        },
        transferAbility: {
          score: 80,
          evidence: "evidence",
          feedback: "feedback",
        },
      },
      mastered: ["a"],
      gaps: ["b"],
      nextSteps: ["c"],
    });

    expect(result.success).toBe(false);
  });
});
