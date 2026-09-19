import { describe, expect, it } from "vitest";
import {
  answeredSocraticQuestionTypes,
  canEnterFeynmanVoluntarily,
  computeUnknownStreak,
  enterFeynmanVoluntarily,
  isLowInformationAnswer,
  nextAfterDiagnosisAnswer,
  nextAfterFeynman,
  nextAfterReportSaved,
  nextAfterSocraticAnswer,
  nextV12Transition,
} from "@/lib/state-machine";

describe("v1.2 required explanation at the experience limit", () => {
  const evidence = { diagnosisFinished: true, constructionReady: false, transferPassed: false, majorError: false };

  it.each([3, 4, 5])("requires explanation then revision at a %i-turn limit without extending the budget", (maxTurns) => {
    for (const stage of ["KNOWLEDGE_CONSTRUCTION", "CASE_TRANSFER"] as const) {
      const explanation = nextV12Transition({ phase: "SOCRATIC", socraticTurns: maxTurns - 1, maxTurns }, { ...evidence, stage });
      expect(explanation).toMatchObject({ phase: "FEYNMAN", stage: "FEYNMAN_OUTPUT", socraticTurns: maxTurns, experienceLimitReached: true, reasonCode: "EXPERIENCE_LIMIT" });
      const reflection = nextV12Transition({ ...explanation, maxTurns }, { ...evidence, stage: explanation.stage, majorError: true });
      expect(reflection).toMatchObject({ phase: "FEYNMAN", stage: "REFLECTION", socraticTurns: maxTurns, reasonCode: "FEYNMAN_COMPLETED" });
      const report = nextV12Transition({ ...reflection, maxTurns }, { ...evidence, stage: reflection.stage, majorError: true });
      expect(report).toMatchObject({ phase: "REPORTING", stage: "REPORT", socraticTurns: maxTurns, reasonCode: "REFLECTION_COMPLETED" });
    }
  });

  it("keeps low-confidence explanation evidence in the same stage even at the turn limit", () => {
    expect(nextV12Transition({ phase: "FEYNMAN", socraticTurns: 5, maxTurns: 5 }, {
      ...evidence, stage: "FEYNMAN_OUTPUT", verificationRequired: true,
    })).toMatchObject({ phase: "FEYNMAN", stage: "FEYNMAN_OUTPUT", socraticTurns: 5, reasonCode: null });
  });

  it("allows an existing reflection session to finish without requiring a replacement explanation", () => {
    expect(nextV12Transition({ phase: "FEYNMAN", socraticTurns: 5, maxTurns: 5 }, {
      ...evidence, stage: "REFLECTION",
    })).toMatchObject({ phase: "REPORTING", stage: "REPORT", socraticTurns: 5, reasonCode: "REFLECTION_COMPLETED" });
  });

  it("still repairs a major error before the turn limit", () => {
    expect(nextV12Transition({ phase: "FEYNMAN", socraticTurns: 3, maxTurns: 5 }, {
      ...evidence, stage: "FEYNMAN_OUTPUT", majorError: true,
    })).toMatchObject({ phase: "SOCRATIC", stage: "KNOWLEDGE_CONSTRUCTION", socraticTurns: 3, reasonCode: "FEYNMAN_MAJOR_BACKTRACK" });
  });
});

describe("state machine", () => {
  it("moves from diagnosis to socratic after a diagnosis answer", () => {
    expect(
      nextAfterDiagnosisAnswer({
        phase: "DIAGNOSIS",
        socraticTurns: 0,
        maxTurns: 5,
      }),
    ).toEqual({
      phase: "SOCRATIC",
      socraticTurns: 0,
      forceFeynman: false,
    });
  });

  it("does not enter Feynman before three Socratic rounds", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticTurns: 1, maxTurns: 5 },
      "REQUEST_FEYNMAN",
    );

    expect(transition.phase).toBe("SOCRATIC");
    expect(transition.socraticTurns).toBe(2);
  });

  it("accepts REQUEST_FEYNMAN after the minimum round count", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticTurns: 2, maxTurns: 5 },
      "REQUEST_FEYNMAN",
    );

    expect(transition.phase).toBe("FEYNMAN");
    expect(transition.socraticTurns).toBe(3);
  });

  it("forces Feynman at the maximum round count", () => {
    const transition = nextAfterSocraticAnswer(
      { phase: "SOCRATIC", socraticTurns: 4, maxTurns: 5 },
      "ASK_QUESTION",
    );

    expect(transition.phase).toBe("FEYNMAN");
    expect(transition.socraticTurns).toBe(5);
    expect(transition.forceFeynman).toBe(true);
  });

  it("allows the learner to enter Feynman after three completed rounds", () => {
    const session = {
      phase: "SOCRATIC" as const,
      socraticTurns: 3,
      maxTurns: 5,
    };

    expect(canEnterFeynmanVoluntarily(session)).toBe(true);
    expect(enterFeynmanVoluntarily(session)).toEqual({
      phase: "FEYNMAN",
      socraticTurns: 3,
      forceFeynman: false,
    });
    expect(
      canEnterFeynmanVoluntarily({ ...session, socraticTurns: 2 }),
    ).toBe(false);
    expect(() =>
      enterFeynmanVoluntarily({ ...session, socraticTurns: 2 }),
    ).toThrow("sufficient Socratic evidence");
  });

  it("detects repeated unknown answers deterministically", () => {
    expect(isLowInformationAnswer("不知道")).toBe(true);
    expect(computeUnknownStreak("不知道", 2)).toBe(3);
    expect(computeUnknownStreak("我认为它和条件变化有关", 2)).toBe(0);
  });

  it.each([
    "本币升值", "货币错配", "外币资产", "利率变化不会必然造成损失",
    "我不是不懂，外币应收代表外币资产，本币升值会降低其折算价值。",
    "我不知道久期的公式，但固定利率债券的价格会在市场利率上升时下降。",
    "The loss would not occur without a foreign currency exposure.",
  ])("preserves substantive answers instead of matching an unknown substring: %s", (answer) => {
    expect(isLowInformationAnswer(answer)).toBe(false);
    expect(computeUnknownStreak(answer, 2)).toBe(0);
  });

  it.each(["我不知道", "不会。", "不清楚，能给个提示吗？", "I don't know.", "no idea", "……"])("recognizes an explicit lack of an answer: %s", (answer) => {
    expect(isLowInformationAnswer(answer)).toBe(true);
  });

  it("counts each substantive reply once while preserving the original question through hints", () => {
    expect(answeredSocraticQuestionTypes([
      { role: "ASSISTANT", phase: "SOCRATIC", content: "是哪种风险？", questionType: "CONCEPT_CLARIFICATION" },
      { role: "USER", phase: "SOCRATIC", content: "不知道", questionType: null },
      { role: "ASSISTANT", phase: "SOCRATIC", content: "先考虑货币种类？", questionType: "SCAFFOLDED_HINT" },
      { role: "USER", phase: "SOCRATIC", content: "货币错配", questionType: null },
      { role: "USER", phase: "SOCRATIC", content: "资产负债币种不同", questionType: null },
      { role: "ASSISTANT", phase: "SOCRATIC", content: "为什么有影响？", questionType: "CAUSE_PROBE" },
    ])).toEqual(["CONCEPT_CLARIFICATION"]);
  });

  it("does not use a standalone hint as a completed Socratic question", () => {
    expect(answeredSocraticQuestionTypes([
      { role: "ASSISTANT", phase: "DIAGNOSIS", content: "如何理解汇率风险？", questionType: "CONCEPT_CLARIFICATION" },
      { role: "USER", phase: "DIAGNOSIS", content: "货币错配", questionType: null },
      { role: "ASSISTANT", phase: "SOCRATIC", content: "考虑外币应收？", questionType: "SCAFFOLDED_HINT" },
      { role: "USER", phase: "SOCRATIC", content: "外币应收随汇率变动而改变折算价值", questionType: null },
    ])).toEqual([]);
  });

  it("rejects transitions from the wrong source phase", () => {
    expect(() =>
      nextAfterDiagnosisAnswer({
        phase: "SOCRATIC",
        socraticTurns: 0,
        maxTurns: 5,
      }),
    ).toThrow("DIAGNOSIS");

    expect(() =>
      nextAfterSocraticAnswer(
        { phase: "FEYNMAN", socraticTurns: 3, maxTurns: 5 },
        "ASK_QUESTION",
      ),
    ).toThrow("SOCRATIC");
  });

  it("uses REPORTING while a report is generated, then completes without changing turns", () => {
    const reporting = nextAfterFeynman({
        phase: "FEYNMAN",
        socraticTurns: 3,
        maxTurns: 5,
      });
    expect(reporting).toEqual({
      phase: "REPORTING",
      socraticTurns: 3,
      forceFeynman: false,
    });
    expect(nextAfterReportSaved({ ...reporting, maxTurns: 5 })).toEqual({ phase: "COMPLETED", socraticTurns: 3, forceFeynman: false });
  });

  it("rejects invalid counters", () => {
    expect(() =>
      nextAfterSocraticAnswer(
        { phase: "SOCRATIC", socraticTurns: -1, maxTurns: 5 },
        "ASK_QUESTION",
      ),
    ).toThrow("non-negative integer");
  });
});
