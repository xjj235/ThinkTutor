import { describe, expect, it } from "vitest";
import { diagnosticQuestionSchema } from "@/lib/contracts";
import { buildInitialSelfExplanation } from "@/lib/initial-question";

describe("ordinary initial self-explanation", () => {
  it("asks one self-contained question and permits an unknown answer", () => {
    const diagnostic = buildInitialSelfExplanation();
    expect(diagnosticQuestionSchema.safeParse(diagnostic).success).toBe(true);
    expect(diagnostic.assistantMessage.match(/[?？]/gu)).toHaveLength(1);
    expect(diagnostic.assistantMessage).toMatch(/不知道/u);
    expect(diagnostic.assistantMessage).toMatch(/用自己的话/u);
    expect(diagnostic.assistantMessage.endsWith("？")).toBe(true);
    expect(diagnostic.questionType).toBe("CONCEPT_CLARIFICATION");
    expect(diagnostic.nextAction).toBe("ASK_QUESTION");
  });

  it("records no student knowledge or answer-linked feedback before an answer", () => {
    const diagnostic = buildInitialSelfExplanation();
    expect(diagnostic.learnerState).toEqual({
      masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [],
    });
    expect(diagnostic.learningFeedback).toBeUndefined();
    expect(diagnostic.webSources).toBeUndefined();
    expect(diagnostic.knowledgePolicy).toBeUndefined();
  });

  it("keeps new and retry sessions independent when a returned draft is changed", () => {
    const previous = buildInitialSelfExplanation();
    previous.assistantMessage = "上一次会话的内容？";
    previous.learnerState.masteryEstimate = 100;
    previous.learnerState.confirmedPoints.push("上一次会话已确认的表述");
    previous.learnerState.gaps.push("上一次会话的缺口");
    previous.learnerState.misconceptions.push("上一次会话的误解");

    const next = buildInitialSelfExplanation();
    expect(next.assistantMessage).not.toBe(previous.assistantMessage);
    expect(next.learnerState).toEqual({
      masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [],
    });
  });
});
