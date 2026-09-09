import { describe, expect, it } from "vitest";
import {
  answerInputSchema,
  createSessionInputSchema,
  coachTurnSchema,
  learningReportDraftSchema,
  learnerStateSchema,
  messageMetadataSchema,
  strengthsSchema,
  webSourceSchema,
  nextStepsSchema,
  reportDimensionsSchema,
  reportGapsSchema,
  feynmanInputSchema,
  sessionIdSchema,
} from "@/lib/contracts";

describe("zod schemas", () => {
  it("validates a task creation payload", () => {
    const result = createSessionInputSchema.safeParse({
      course: "",
      chapter: "第一章",
      topic: "系统性风险",
      objective: "解释传染机制",
      learnerLevel: "有基础",
      referenceText: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.course).toBeUndefined();
      expect(result.data.referenceText).toBeUndefined();
    }
  });

  it("returns Chinese messages for missing task fields", () => {
    const result = createSessionInputSchema.safeParse({
      course: "",
      chapter: "",
      topic: "",
      objective: "",
      learnerLevel: "",
      referenceText: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.topic).toContain("请填写知识点。");
      expect(fields.objective).toContain("请填写学习目标。");
      expect(fields.learnerLevel).toContain("请选择学习者水平。");
    }
  });

  it.each([1, 9, 10, 29, 30, 2000, 2001, 4000, 4001, 20_001])("accepts %i characters without a learning length quota", (length) => {
    const text = "答".repeat(length);
    expect(answerInputSchema.parse({ answer: text, clientRequestId: "answer-length-001" }).answer).toBe(text);
    expect(feynmanInputSchema.parse({ explanation: text, clientRequestId: "feynman-length-001" }).explanation).toBe(text);
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
      overallLevel: "发展中",
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

    expect(result.success).toBe(false);
  });

  it("validates every JSON-backed report field with a dedicated schema", () => {
    const dimensions = {
      conceptCompleteness: { score: 80, evidence: "e", feedback: "f" },
      logicCompleteness: { score: 80, evidence: "e", feedback: "f" },
      expressionClarity: { score: 80, evidence: "e", feedback: "f" },
      exampleAbility: { score: 80, evidence: "e", feedback: "f" },
      transferAbility: { score: 80, evidence: "e", feedback: "f" },
    };

    expect(reportDimensionsSchema.safeParse(dimensions).success).toBe(true);
    expect(strengthsSchema.safeParse([{ title: "概念", evidence: "学生明确解释了该概念。" }]).success).toBe(true);
    expect(strengthsSchema.safeParse([{ title: "概念" }]).success).toBe(false);
    expect(
      reportGapsSchema.safeParse([
        {
          title: "迁移条件",
          evidence: "本次对话未充分展示迁移能力。",
          repairTask: "分析一个新的应用场景。",
          priority: 5,
        },
      ]).success,
    ).toBe(true);
    expect(reportGapsSchema.safeParse(["迁移条件"]).success).toBe(false);
    expect(nextStepsSchema.safeParse(["1", "2", "3", "4"]).success).toBe(
      false,
    );
  });

  it.each(["", " ", "\n\t　"])("still rejects blank learning input: %j", (text) => {
    expect(
      answerInputSchema.safeParse({
        answer: text,
        clientRequestId: "answer-minimum-001",
      }).success,
    ).toBe(false);
    expect(
      feynmanInputSchema.safeParse({
        explanation: text,
        clientRequestId: "feynman-minimum-001",
      }).success,
    ).toBe(false);
  });

  it("trims surrounding whitespace without changing the submitted content", () => {
    expect(answerInputSchema.parse({ answer: "  答\n", clientRequestId: "answer-trim-001" }).answer).toBe("答");
    expect(feynmanInputSchema.parse({ explanation: "\n否　", clientRequestId: "feynman-trim-001" }).explanation).toBe("否");
  });

  it("accepts the documented Socratic coach output", () => {
    expect(
      coachTurnSchema.safeParse({
        assistantMessage:
          "你提到银行之间存在资金联系。这些联系具体可能包括哪些形式？",
        questionType: "CONCEPT_CLARIFICATION",
        learnerState: {
          masteryEstimate: 48,
          confirmedPoints: ["认识到银行间存在关联"],
          gaps: ["尚未说明关联的具体形式"],
          misconceptions: [],
        },
        nextAction: "ASK_QUESTION",
        transitionReason: "当前回答仍缺少关键机制说明",
      }).success,
    ).toBe(true);
  });

  it("accepts empty report list fields from the documented report output", () => {
    const dimension = { score: 60, evidence: "学生回答中的证据。", feedback: "具体反馈。" };
    expect(
      learningReportDraftSchema.safeParse({
        summary: "学生已展示部分理解，但仍需补充传播路径。",
        overallLevel: "发展中",
        dimensions: {
          conceptCompleteness: { ...dimension, score: 72 },
          logicCompleteness: { ...dimension, score: 65 },
          expressionClarity: { ...dimension, score: 80 },
          exampleAbility: dimension,
          transferAbility: { ...dimension, score: 40 },
        },
        strengths: [],
        gaps: [],
        nextSteps: [],
        disclaimer: "本报告仅依据本次学习对话生成，属于形成性学习反馈，不代表标准化能力测评结果。",
      }).success,
    ).toBe(true);
  });

  it("validates learner state and message metadata JSON", () => {
    const learnerState = {
      masteryEstimate: 42,
      confirmedPoints: ["理解核心概念"],
      gaps: ["迁移条件"],
      misconceptions: [],
    };
    expect(learnerStateSchema.safeParse(learnerState).success).toBe(true);
    expect(
      messageMetadataSchema.safeParse({
        learnerState,
        nextAction: "ASK_QUESTION",
        transitionReason: "仍需确认迁移条件。",
      }).success,
    ).toBe(true);
    expect(
      learnerStateSchema.safeParse({ ...learnerState, masteryEstimate: 101 }).success,
    ).toBe(false);
  });

  it("accepts only credential-free HTTPS web sources", () => {
    expect(webSourceSchema.safeParse({ title: "可信来源", url: "https://example.com/article" }).success).toBe(true);
    for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "https://user:secret@example.com/article"]) {
      expect(webSourceSchema.safeParse({ title: "危险来源", url }).success).toBe(false);
    }
  });
});
