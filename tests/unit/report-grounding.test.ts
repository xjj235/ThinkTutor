import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { assertReportGrounding } from "@/lib/ai/report-grounding";
import { dimensionKeys } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";

const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "汇率风险", objective: "解释汇率变化如何影响企业", learnerLevel: "入门" };
const answer = "企业收入与支出的币种不同，汇率变化可能改变本币利润。";
async function validDraft() {
  const draft = await new MockAIProvider().createLearningReport({ task, messages: [], feynmanExplanation: answer });
  for (const key of dimensionKeys) draft.dimensions[key].evidence = `学生原文：“${answer}”`;
  return draft;
}
afterEach(() => { vi.unstubAllEnvs(); resetServerEnvForTests(); });

describe("report attribution", () => {
  it("accepts actual student quotations", async () => {
    const draft = await validDraft();
    expect(() => assertReportGrounding(draft, [answer])).not.toThrow();
  });
  it("rejects high scores supported by invented quotations or no quotation", async () => {
    const draft = await validDraft();
    draft.dimensions.conceptCompleteness.score = 100;
    draft.dimensions.conceptCompleteness.evidence = "学生原文：“通过套期保值可以消除任何情况下的全部风险。”";
    expect(() => assertReportGrounding(draft, [answer])).toThrow("学生原文");
    draft.dimensions.conceptCompleteness.evidence = "学生已经全面掌握。";
    expect(() => assertReportGrounding(draft, [answer])).toThrow("学生原文");
  });
  it("accepts explicitly missing evidence only at the lowest band", async () => {
    const draft = await validDraft();
    draft.dimensions.transferAbility = { score: 25, evidence: "本次对话未充分展示迁移能力。", feedback: "请补充新场景。" };
    expect(() => assertReportGrounding(draft, [answer])).not.toThrow();
    draft.dimensions.transferAbility.score = 100;
    expect(() => assertReportGrounding(draft, [answer])).toThrow();
  });
  it.each(["学生原文：“凭空捏造", "学生原文：“错”"])("rejects malformed or invented short citations at low scores: %s", async (evidence) => {
    const draft = await validDraft();
    draft.dimensions.transferAbility = { score: 25, evidence, feedback: "请补充新场景。" };
    expect(() => assertReportGrounding(draft, [answer])).toThrow();
  });
  it("does not accept assistant text or a fabricated strength as student evidence", async () => {
    const draft = await validDraft();
    draft.strengths = [{ title: "迁移", evidence: "学生原文：“已经理解所有复杂场景。”" }];
    expect(() => assertReportGrounding(draft, [answer])).toThrow();
  });
  it("regenerates invalid evidence before returning a real-provider report", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-only-key");
    vi.stubEnv("AI_MAX_RETRIES", "1");
    const good = await validDraft();
    const bad = structuredClone(good);
    bad.dimensions.logicCompleteness.evidence = "学生原文：“这句话只有教练说过。”";
    const response = (value: typeof good) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(bad)).mockResolvedValueOnce(response(good));
    const result = await new DeepSeekProvider({ fetcher }).createLearningReport({
      task, messages: [{ role: "ASSISTANT", phase: "SOCRATIC", content: "这句话只有教练说过。", questionType: null }], feynmanExplanation: answer,
    });
    expect(result).toEqual(good);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

it("distinguishes a quoted missing concept or coach question from student attribution in gaps", async () => {
  const draft = await validDraft();
  draft.gaps = [{ title: "不利方向待补充", evidence: "教练追问了“净头寸是多少”，学生未说明“不利影响”的条件。", repairTask: "请说明方向。", priority: 5 }];
  expect(() => assertReportGrounding(draft, [answer])).not.toThrow();
  draft.gaps[0].evidence = "学生原文：“完全虚构的回答”";
  expect(() => assertReportGrounding(draft, [answer])).toThrow();
});
