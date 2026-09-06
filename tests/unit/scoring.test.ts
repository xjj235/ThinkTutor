import { describe, expect, it } from "vitest";
import {
  computeOverallScore,
  finalizeReportDraft,
  getHighestPriorityGap,
} from "@/lib/scoring";

describe("report scoring", () => {
  it("computes rounded arithmetic average from five dimensions", () => {
    expect(computeOverallScore([80, 81, 82, 83, 84])).toBe(82);
    expect(computeOverallScore([70, 70, 71, 71, 71])).toBe(71);
    expect(computeOverallScore([72, 65, 80, 60, 40])).toBe(63);
  });

  it("adds disclaimer and does not require model overallScore", () => {
    const finalized = finalizeReportDraft({
      summary: "summary",
      overallLevel: "发展中",
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
      strengths: [{ title: "a", evidence: "student evidence" }],
      gaps: [
        {
          title: "b",
          evidence: "evidence",
          repairTask: "repair",
          priority: 5,
        },
      ],
      nextSteps: ["c"],
      disclaimer: "本报告仅依据本次学习对话生成，属于形成性学习反馈，不代表标准化能力测评结果。",
    });

    expect(finalized.overallScore).toBe(60);
    expect(finalized.disclaimer).toContain("形成性学习反馈");
  });

  it("selects the highest-priority structured gap", () => {
    expect(
      getHighestPriorityGap([
        { title: "次要", evidence: "e1", repairTask: "r1", priority: 2 },
        { title: "优先", evidence: "e2", repairTask: "r2", priority: 5 },
      ])?.title,
    ).toBe("优先");
    expect(getHighestPriorityGap([])).toBeNull();
  });

  it("rejects missing or invalid dimensions", () => {
    expect(() => computeOverallScore([80, 80, 80, 80])).toThrow(
      "exactly five",
    );
    expect(() => computeOverallScore([80, 80, 80, 80, 101])).toThrow(
      "0 to 100",
    );
    expect(() => computeOverallScore([80, 80, 80, 80, 79.5])).toThrow(
      "integers",
    );
  });
});
