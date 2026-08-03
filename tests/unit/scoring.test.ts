import { describe, expect, it } from "vitest";
import { computeOverallScore, finalizeReportDraft } from "@/lib/scoring";

describe("report scoring", () => {
  it("computes rounded arithmetic average from five dimensions", () => {
    expect(computeOverallScore([80, 81, 82, 83, 84])).toBe(82);
    expect(computeOverallScore([70, 70, 71, 71, 71])).toBe(71);
  });

  it("adds disclaimer and does not require model overallScore", () => {
    const finalized = finalizeReportDraft({
      summary: "summary",
      dimensions: {
        conceptCompleteness: {
          score: 80,
          evidence: "evidence",
          feedback: "feedback",
        },
        logicCompleteness: {
          score: 70,
          evidence: "evidence",
          feedback: "feedback",
        },
        expressionClarity: {
          score: 60,
          evidence: "evidence",
          feedback: "feedback",
        },
        exampleAbility: {
          score: 50,
          evidence: "evidence",
          feedback: "feedback",
        },
        transferAbility: {
          score: 40,
          evidence: "evidence",
          feedback: "feedback",
        },
      },
      mastered: ["a"],
      gaps: ["b"],
      nextSteps: ["c"],
    });

    expect(finalized.overallScore).toBe(60);
    expect(finalized.disclaimer).toContain("形成性学习反馈");
  });
});
