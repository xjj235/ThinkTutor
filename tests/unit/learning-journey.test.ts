import { describe, expect, it } from "vitest";
import type { LearningReportDTO, MessageDTO } from "@/lib/contracts";
import { feynmanSteps, learningJourneySteps, learningSteps } from "@/lib/learning-journey";
import { learningFeedbackSchema } from "@/lib/learning-feedback";

const feedback = learningFeedbackSchema.parse({ answerQuote: "只有直接联系才会传染", observation: "你提出了直接联系这一条件。", focus: "这个条件是否必要", whyItMatters: "检验条件有助于分清结论适用的范围。", progress: null });
function message(id: string, role: MessageDTO["role"], content: string, extra: Partial<MessageDTO> = {}): MessageDTO {
  return { id, role, content, phase: "SOCRATIC", questionType: null, clientRequestId: null, webSources: [], knowledgePolicy: null, createdAt: "2026-09-29T00:00:00.000Z", ...extra };
}
function report(sessionId = "session"): LearningReportDTO {
  const dimension = { score: 50, evidence: "这是本次作答原文", feedback: "仍需核对适用条件" };
  return {
    id: "report", sessionId, summary: "整次学习中补充了传播机制，条件仍需核对。", overallScore: 50, overallLevel: "发展中",
    dimensions: { conceptCompleteness: dimension, logicCompleteness: dimension, expressionClarity: dimension, exampleAbility: dimension, transferAbility: dimension },
    strengths: [], gaps: [{ title: "适用条件", evidence: "尚未说明条件改变后的判断", repairTask: "改变一个条件后重新判断", priority: 5, status: "OPEN" }],
    nextSteps: [], disclaimer: "形成性反馈", createdAt: "2026-09-29T00:00:01.000Z",
  };
}

describe("evidence-based learning journey", () => {
  it("connects the original answer, follow-up, new answer and its actual review", () => {
    const result = learningSteps([
      message("a", "USER", "我认为只有直接联系才会传染"),
      message("q", "ASSISTANT", "没有直接联系时会发生什么？", { learningFeedback: feedback, feedbackForMessageId: "a" }),
      message("hint", "ASSISTANT", "先只考虑价格变化。", { questionType: "SCAFFOLDED_HINT" }),
      message("b", "USER", "共同资产价格变化也会传播风险"),
      message("r", "ASSISTANT", "这个判断有哪些条件？", { feedbackForMessageId: "b", learningFeedback: { ...feedback, answerQuote: "共同资产价格变化", progress: "这次补充了价格变化这一传播线索。" } }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].answer.id).toBe("a");
    expect(result[0].response?.id).toBe("b");
    expect(result[0].responseStatus).toBe("answered");
    expect(result[0].review?.progress).toContain("价格变化");
    expect(result[1].response).toBeUndefined();
    expect(result[1].responseStatus).toBe("awaiting");
  });

  it("does not invent feedback for legacy, invalid references or quoted assistant text", () => {
    const result = learningSteps([
      message("old", "ASSISTANT", feedback.answerQuote),
      message("a", "USER", "不知道"),
      message("q", "ASSISTANT", "继续想？", { feedbackForMessageId: "a", learningFeedback: feedback }),
      message("q2", "ASSISTANT", "继续想？", { feedbackForMessageId: "old", learningFeedback: feedback }),
      message("q3", "ASSISTANT", "继续想？", { feedbackForMessageId: "future", learningFeedback: feedback }),
      message("future", "USER", feedback.answerQuote),
    ]);
    expect(result).toEqual([]);
  });

  it("keeps a follow-up answer unverified when no assessment exists", () => {
    const result = learningSteps([
      message("a", "USER", feedback.answerQuote),
      message("q", "ASSISTANT", "继续想？", { feedbackForMessageId: "a", learningFeedback: feedback }),
      message("b", "USER", "我现在全懂了"),
      message("r", "ASSISTANT", "请独立解释。"),
    ]);
    expect(result[0].response?.content).toBe("我现在全懂了");
    expect(result[0].review).toBeUndefined();
  });

  it("does not attach a recovery or replacement task's answer to an earlier question", () => {
    const result = learningSteps([
      message("a", "USER", feedback.answerQuote),
      message("q", "ASSISTANT", "继续想？", { feedbackForMessageId: "a", learningFeedback: feedback }),
      message("resume", "ASSISTANT", "恢复后先独立解释另一个知识点。"),
      message("b", "USER", "这是对恢复任务的回答"),
    ]);
    expect(result[0].response).toBeUndefined();
    expect(result[0].responseStatus).toBe("replaced");
  });

  it("uses final feedback as a review without presenting a completed report as an unanswered task", () => {
    const result = learningSteps([
      message("a", "USER", feedback.answerQuote),
      message("q", "ASSISTANT", "请独立解释。", { feedbackForMessageId: "a", learningFeedback: feedback, phase: "FEYNMAN" }),
      message("b", "USER", "这是补充的解释", { phase: "FEYNMAN" }),
      message("report", "ASSISTANT", "报告已生成。", { phase: "COMPLETED", feedbackForMessageId: "b", learningFeedback: { ...feedback, answerQuote: "补充的解释" } }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].review?.answerQuote).toBe("补充的解释");
  });

  it("keeps a voluntary explanation as a separate task without assigning it to the replaced question", () => {
    const messages = [
      message("a", "USER", feedback.answerQuote),
      message("q", "ASSISTANT", "继续核对条件？", { feedbackForMessageId: "a", learningFeedback: feedback }),
      message("feynman", "ASSISTANT", "请面向初学者独立讲解。", { phase: "FEYNMAN" }),
      message("final", "USER", "这是我最终修正后的独立讲解。", { phase: "FEYNMAN" }),
    ];
    const result = learningJourneySteps(messages, "session", report());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "feedback", step: { responseStatus: "replaced" } });
    expect(result[0].step.response).toBeUndefined();
    expect(result[0].report).toBeUndefined();
    expect(result[1]).toMatchObject({ kind: "feynman", step: { question: { id: "feynman" }, response: { id: "final" }, responseStatus: "answered" }, report: report() });
    expect(result[1].step).not.toHaveProperty("answer");
    expect(result[1].step).not.toHaveProperty("feedback");
    expect(result[1].step.review).toBeUndefined();
  });

  it("adds the overall report to an existing automatic explanation step without duplicating it", () => {
    const messages = [
      message("a", "USER", feedback.answerQuote),
      message("feynman", "ASSISTANT", "请独立解释。", { phase: "FEYNMAN", feedbackForMessageId: "a", learningFeedback: feedback }),
      message("final", "USER", "这是补充的解释", { phase: "FEYNMAN" }),
      message("review", "ASSISTANT", "报告已生成。", { phase: "COMPLETED", feedbackForMessageId: "final", learningFeedback: { ...feedback, answerQuote: "补充的解释" } }),
    ];
    expect(feynmanSteps(messages)).toEqual([]);
    const result = learningJourneySteps(messages, "session", report());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "feedback", report: report(), step: { response: { id: "final" }, review: { answerQuote: "补充的解释" } } });
  });

  it("keeps waiting historical tasks, excludes hints and respects a replacement before the answer", () => {
    const tasks = [
      message("first", "ASSISTANT", "先解释原来的条件。", { phase: "FEYNMAN" }),
      message("hint", "ASSISTANT", "先想参与者的行为。", { phase: "FEYNMAN", questionType: "SCAFFOLDED_HINT" }),
    ];
    expect(feynmanSteps(tasks)).toMatchObject([{ question: { id: "first" }, responseStatus: "awaiting" }]);
    const result = learningJourneySteps([
      ...tasks,
      message("replacement", "ASSISTANT", "请改为解释新的情境。", { phase: "FEYNMAN" }),
      message("final", "USER", "这是新情境下的讲解。", { phase: "FEYNMAN" }),
    ], "session", report());
    expect(result).toHaveLength(2);
    expect(result[0].step.responseStatus).toBe("replaced");
    expect(result[0].step.response).toBeUndefined();
    expect(result[0].report).toBeUndefined();
    expect(result[1].step.response?.id).toBe("final");
    expect(result[1].report?.id).toBe("report");
  });

  it("does not create a comparison or task from an orphan answer, invalid feedback or an empty prompt", () => {
    const messages = [
      message("orphan", "USER", "独立讲解没有对应的任务。", { phase: "FEYNMAN" }),
      message("invalid", "ASSISTANT", "这份引用无法绑定。", { phase: "FEYNMAN", feedbackForMessageId: "missing", learningFeedback: feedback }),
      message("partial", "ASSISTANT", "缺少逐轮反馈原文。", { phase: "FEYNMAN", feedbackForMessageId: "orphan" }),
      message("empty", "ASSISTANT", " ", { phase: "FEYNMAN" }),
      message("hint", "ASSISTANT", "提示不能冒充独立任务。", { phase: "FEYNMAN", questionType: "SCAFFOLDED_HINT" }),
      message("final", "USER", "另一次独立讲解。", { phase: "FEYNMAN" }),
    ];
    expect(learningJourneySteps(messages, "session", report())).toEqual([]);
    const wrongPhase = feynmanSteps([
      message("task", "ASSISTANT", "请独立解释。", { phase: "FEYNMAN" }),
      message("other", "USER", "这是普通追问的回答。"),
    ]);
    expect(wrongPhase[0].response).toBeUndefined();
    expect(wrongPhase[0].responseStatus).toBe("replaced");
  });

  it("only attaches a report from this session to its final answered explanation task", () => {
    const messages = [
      message("first", "ASSISTANT", "请先作独立解释。", { phase: "FEYNMAN" }),
      message("first-answer", "USER", "这是第一份讲解。", { phase: "FEYNMAN" }),
      message("final-task", "ASSISTANT", "请修订你的讲解。", { phase: "FEYNMAN" }),
      message("final", "USER", "这是最后的修订。", { phase: "FEYNMAN" }),
    ];
    const matched = learningJourneySteps(messages, "session", report());
    expect(matched[0].report).toBeUndefined();
    expect(matched[1].report?.id).toBe("report");
    expect(matched[1].step.review).toBeUndefined();
    expect(learningJourneySteps(messages, "session", report("other-session")).every((entry) => !entry.report)).toBe(true);
    expect(learningJourneySteps(messages.slice(0, -1), "session", report()).every((entry) => !entry.report)).toBe(true);
    expect(learningJourneySteps(messages, "session").every((entry) => !entry.report)).toBe(true);
  });

  it("preserves a recovery task in the Feynman phase without calling its answer independent progress", () => {
    const messages = [
      message("resume", "ASSISTANT", "恢复核验：请说明一个新情境的适用条件。", { phase: "FEYNMAN" }),
      message("verification", "USER", "这是恢复核验的作答。", { phase: "FEYNMAN" }),
      message("restored", "ASSISTANT", "恢复核验完成，继续原来的独立讲解。", { phase: "FEYNMAN", feedbackForMessageId: "verification", learningFeedback: { ...feedback, answerQuote: "恢复核验的作答" } }),
      message("final", "USER", "这是原任务的最终讲解。", { phase: "FEYNMAN" }),
    ];
    const result = learningJourneySteps(messages, "session", report());
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "feynman", step: { question: { id: "resume" }, response: { id: "verification" }, review: { progress: null } } });
    expect(result[0].step).not.toHaveProperty("feedback");
    expect(result[0].report).toBeUndefined();
    expect(result[1]).toMatchObject({ kind: "feedback", step: { response: { id: "final" } }, report: report() });
  });
});
