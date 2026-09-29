import { describe, expect, it } from "vitest";
import { assertDiagnosticReview, diagnosticReviewSchema, normalizeInitialDiagnostic, type DiagnosticReview } from "@/lib/ai/diagnostic";
import type { DiagnosticQuestion } from "@/lib/contracts";

function candidate(assistantMessage: string): DiagnosticQuestion {
  return {
    assistantMessage,
    questionType: "CONCEPT_CLARIFICATION",
    learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] },
    nextAction: "ASK_QUESTION",
    transitionReason: "等待首次作答。",
  };
}

function passingReview(overrides: Partial<DiagnosticReview> = {}): DiagnosticReview {
  return diagnosticReviewSchema.parse({
    minimumAnswer: "可以用自己的话表达当前理解，也可以说明暂时不确定。",
    attributedStudentClaims: [],
    missingInformationQuote: null,
    questionAnswerable: true,
    singleMainQuestion: true,
    noAnswerLeak: true,
    answerLeakQuote: null,
    ...overrides,
  });
}

describe("initial diagnostic evidence boundaries", () => {
  it("discards invented learner evidence while preserving the question and source metadata without mutation", () => {
    const original = {
      ...candidate("你现在如何理解汇率风险？"),
      learnerState: { masteryEstimate: 80, confirmedPoints: ["已掌握教师资料中的定义"], gaps: ["尚未掌握方向"], misconceptions: ["方向错误"] },
      learningFeedback: { answerQuote: "教师资料原文", observation: "你已经注意到风险", focus: "方向", whyItMatters: "区分收付款", progress: "已经纠正方向" },
      webSources: [{ title: "课程材料", url: "https://example.org/course" }],
      knowledgePolicy: "COURSE_KNOWLEDGE_FIRST" as const,
    };
    const output = normalizeInitialDiagnostic(original);
    expect(output.learnerState).toEqual({ masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] });
    expect(output.learningFeedback).toBeUndefined();
    expect(output.assistantMessage).toBe(original.assistantMessage);
    expect(output.webSources).toEqual(original.webSources);
    expect(output.knowledgePolicy).toBe(original.knowledgePolicy);
    expect(output.transitionReason).toContain("等待学生作答");
    expect(original.learningFeedback.answerQuote).toBe("教师资料原文");
    expect(original.learnerState.confirmedPoints).toEqual(["已掌握教师资料中的定义"]);
  });

  it.each([
    "你现在如何理解汇率风险？",
    "在三角形ABC中，角C为90度，直角所对的是哪条边？",
    "在直角三角形中，直角所对的边叫作斜边。在三角形ABC中，∠C=90°，哪条边是斜边？",
    "请你自己画出并标注一个直角三角形，其中哪条边是斜边？",
    "请你自选一个食物链例子，用自己的话说明它表达的生物之间的关系？",
  ])("accepts an independently reviewed self-contained starting task: %s", (question) => {
    expect(() => assertDiagnosticReview(candidate(question), passingReview())).not.toThrow();
  });

  it("rejects attributing teacher reference knowledge to a student who has not answered", () => {
    const question = candidate("你提到直角所对的边是斜边，那么在一个具体直角三角形里，你能找出直角的位置，并说出哪条边是斜边吗？");
    expect(() => assertDiagnosticReview(question, passingReview({
      attributedStudentClaims: ["你提到直角所对的边是斜边"],
    }))).toThrow(expect.objectContaining({ code: "AI_INVALID_OUTPUT", retryable: true }));
  });

  it("rejects absent figure information even when there is no invented student claim", () => {
    const question = candidate("在上面的图中，哪一个箭头表示能量从生产者流向消费者？");
    expect(() => assertDiagnosticReview(question, passingReview({
      minimumAnswer: "没有提供图、箭头或文字关系，无法定位。",
      missingInformationQuote: "在上面的图中",
      questionAnswerable: false,
    }))).toThrow(expect.objectContaining({ code: "AI_INVALID_OUTPUT", retryable: true }));
  });

  it("rejects asking for a paraphrase after supplying the relation, even when the task is otherwise answerable", () => {
    const question = candidate("直角与斜边的位置关系可以用“直角所对的那条边”来描述，请你用自己的话说说它们的位置关系是什么？");
    expect(() => assertDiagnosticReview(question, passingReview({
      minimumAnswer: "斜边是直角所对的边。",
      noAnswerLeak: false,
      answerLeakQuote: "直角与斜边的位置关系可以用“直角所对的那条边”来描述",
    }))).toThrow(expect.objectContaining({ code: "AI_INVALID_OUTPUT", retryable: true }));
  });

  it.each([
    { questionAnswerable: false },
    { singleMainQuestion: false },
    { noAnswerLeak: false },
    { attributedStudentClaims: ["你已经懂了基本概念"] },
    { missingInformationQuote: "图中" },
    { answerLeakQuote: "结论就是增加" },
  ] satisfies Array<Partial<DiagnosticReview>>)("fails closed on an incomplete or contradictory review: %j", (review) => {
    const question = candidate("你已经懂了基本概念，图中的结论就是增加，所以结果是什么？");
    expect(() => assertDiagnosticReview(question, passingReview(review))).toThrow(expect.objectContaining({ code: "AI_INVALID_OUTPUT" }));
  });

  it("does not accept an unsupported review quote as evidence for a candidate", () => {
    expect(() => assertDiagnosticReview(candidate("你现在如何理解货币错配？"), passingReview({
      attributedStudentClaims: ["你刚才解释了货币错配"],
    }))).toThrow(expect.objectContaining({ code: "AI_INVALID_OUTPUT" }));
  });
});
