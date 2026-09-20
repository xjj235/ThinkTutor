import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { buildLearningContext } from "@/lib/ai/context-builder";
import { getStudentKnowledgeCatalog, resolveKnowledgeSelection } from "@/lib/knowledge/student-catalog";
import { resetServerEnvForTests } from "@/lib/env";
import { coachTurnSchema, diagnosticQuestionSchema, type MessageDTO } from "@/lib/contracts";

config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_KNOWLEDGE_QA_LIVE === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
type Turn = Pick<MessageDTO, "role" | "phase" | "content" | "questionType">;
const rawOutputs: Array<{ topic: string; content: string | null; finishReason: string | null; outputTokens: number | null }> = [];
const records: Array<{ topic: string; objective: string; diagnostic: string; answer: string; followUp: string; hints?: string[]; report?: unknown }> = [];
const answers = [
  "我认为汇率上涨不会必然让企业亏损，因为收入和支出的币种不同，应该先看净外币敞口。例如出口企业有美元收入，也可能有美元采购成本。",
  "经济周期风险不是所有企业同时亏损，而是需求、信用和现金流可能随景气变化。比如衰退时订单减少，固定成本较高的企业更难覆盖支出。",
  "利率风险可能影响融资成本，也可能改变资产价值。固定利率贷款不一定马上增加利息支出，但浮动利率借款可能在重定价后受到影响。",
  "通货膨胀风险和单一商品涨价不同，普遍物价上涨会降低货币购买力。企业是否受损还要看能否提高售价以及成本上涨幅度。",
  "政策风险涉及政策变化或执行变化引起的不确定性。比如补贴条件调整可能影响企业现金流，但需要先确认企业是否依赖这一补贴。",
];

describe.skipIf(!enabled)("real-model student knowledge questions", () => {
  beforeAll(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false");
    vi.stubEnv("AI_MAX_RETRIES", "1");
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "90000");
    resetServerEnvForTests();
  });
  afterAll(async () => {
    await mkdir(".data/knowledge-qa-live", { recursive: true });
    await writeFile(".data/knowledge-qa-live/results.json", JSON.stringify({ generatedAt: new Date().toISOString(), model: process.env.DEEPSEEK_MODEL, records, rawOutputs }, null, 2), "utf8");
    vi.unstubAllEnvs();
    resetServerEnvForTests();
  });
  it.each(getStudentKnowledgeCatalog().map((topic, index) => ({ topic, index })))("asks and follows up within $topic.title", async ({ topic, index }) => {
    const task = { ...resolveKnowledgeSelection({ topicId: topic.id, unitId: topic.units[0].id }), learnerLevel: "入门", referenceText: undefined };
    const provider = new DeepSeekProvider({ fetcher: async (url, init) => {
      const response = await fetch(url, init);
      if (response.ok) {
        const output = await response.clone().json() as { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>; usage?: { completion_tokens?: number } };
        rawOutputs.push({ topic: topic.title, content: output.choices?.[0]?.message?.content ?? null, finishReason: output.choices?.[0]?.finish_reason ?? null, outputTokens: output.usage?.completion_tokens ?? null });
      }
      return response;
    } });
    const context = await buildLearningContext({ ...task, messages: [] });
    expect(context.retrievedContext[0]).toContain(topic.units[0].id);
    const diagnostic = await provider.createDiagnosticQuestion({ task, ...context });
    expect(diagnosticQuestionSchema.safeParse({ assistantMessage: diagnostic.assistantMessage, questionType: diagnostic.questionType, learnerState: diagnostic.learnerState, nextAction: diagnostic.nextAction, transitionReason: diagnostic.transitionReason }).success).toBe(true);
    const answer = answers[index];
    const messages: Turn[] = [
      { role: "ASSISTANT", phase: "DIAGNOSIS", content: diagnostic.assistantMessage, questionType: diagnostic.questionType },
      { role: "USER", phase: "DIAGNOSIS", content: answer, questionType: null },
    ];
    const input = { task, phase: "SOCRATIC" as const, socraticTurns: 0, maxTurns: 5, unknownStreak: 0, learnerState: diagnostic.learnerState, messages, latestAnswer: answer, retrievedContext: context.retrievedContext, knowledgePolicy: context.knowledgePolicy };
    const followUp = await provider.createCoachTurn(input);
    expect(coachTurnSchema.safeParse({ assistantMessage: followUp.assistantMessage, questionType: followUp.questionType, learnerState: followUp.learnerState, nextAction: followUp.nextAction, transitionReason: followUp.transitionReason }).success).toBe(true);
    expect(followUp.assistantMessage).not.toBe(diagnostic.assistantMessage);
    expect(followUp.assistantMessage).not.toMatch(/C_SR_|DQ_SR_|系统性风险/);
    const record: (typeof records)[number] = { topic: task.topic, objective: task.objective, diagnostic: diagnostic.assistantMessage, answer, followUp: followUp.assistantMessage };
    records.push(record);
    if (index === 0) {
      messages.push({ role: "ASSISTANT", phase: "SOCRATIC", content: followUp.assistantMessage, questionType: followUp.questionType });
      record.hints = [];
      for (const unknownStreak of [1, 2, 3]) {
        const hint = await provider.createCoachTurn({ ...input, latestAnswer: undefined, isHintRequest: true, unknownStreak, messages: [...messages] });
        expect((hint.assistantMessage.match(/[?？]/g) ?? []).length).toBe(1);
        expect(hint.assistantMessage).not.toBe(messages.at(-1)?.content);
        expect(hint.questionType).toBe("SCAFFOLDED_HINT");
        record.hints.push(hint.assistantMessage);
        messages.push({ role: "ASSISTANT", phase: "SOCRATIC", content: hint.assistantMessage, questionType: "SCAFFOLDED_HINT" });
      }
      expect(new Set(record.hints).size).toBe(3);
      record.report = await provider.createLearningReport({ task, messages, feynmanExplanation: answer, retrievedContext: context.retrievedContext });
    }
  }, 420000);
});
