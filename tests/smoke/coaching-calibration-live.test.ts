import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { resetServerEnvForTests } from "@/lib/env";
import { createSessionInputSchema, learningReportDraftSchema, coachTurnSchema } from "@/lib/contracts";
import { coachConditionalCheckSchema, coachPrerequisiteEvidenceSchema } from "@/lib/ai/coach-feedback";
import { learningFeedbackSchema } from "@/lib/learning-feedback";
import type { CoachTurnInput, SourcedCoachTurn } from "@/lib/ai/types";
import cases from "./coaching-calibration-cases.json";

// Only the database telemetry sink is replaced. Every generation and content /
// teaching review uses the real provider and HTTP endpoint.
const telemetry = vi.hoisted(() => ({ usage: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db", () => ({ prisma: { aIUsage: {
  create: async (input: { data: Record<string, unknown> }) => {
    telemetry.usage.push(input.data);
    return { id: `calibration-${telemetry.usage.length}`, ...input.data };
  },
} } }));

config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const fixtureSchema = z.object({
  reviewStatus: z.literal("PENDING_TEACHER_REVIEW"), scope: z.string(), reviewChecklist: z.array(z.string()),
  cases: z.array(z.object({
    id: z.string(), task: createSessionInputSchema,
    turns: z.array(z.object({ answer: z.string(), intent: z.enum(["misconception", "revision", "unknown", "incomplete"]) })),
  })),
});
const fixtures = fixtureSchema.parse(cases);
const responseSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable().optional() }) })).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
});
interface RequestRecord {
  scenario: string; turn: number; operation: "generation" | "content_review" | "disclosure_review" | "teaching_review" | "report";
  elapsedMs: number; status: number | null; finishReason: string | null; totalTokens: number | null;
  transportFailure: boolean;
}
interface TurnRecord {
  scenario: string; turn: number; answer: string; intent: string; elapsedMs: number;
  output: SourcedCoachTurn | null; errorCode: string | null; automaticChecksPassed: boolean;
}
const requests: RequestRecord[] = [];
const turns: TurnRecord[] = [];
const reports: Array<{ scenario: string; output: z.infer<typeof learningReportDraftSchema> }> = [];
const auditSchema = z.object({ minimumAnswer: z.string(), verdict: z.string(), conditionalCheck: coachConditionalCheckSchema.nullable(), prerequisiteEvidence: z.array(coachPrerequisiteEvidenceSchema), inconsistentGivens: z.object({ quotes: z.array(z.string()), conflict: z.string() }).nullable() });
const drafts: Array<{ scenario: string; turn: number; content: z.infer<typeof coachTurnSchema> | z.infer<typeof auditSchema> }> = [];
function operationOf(init?: RequestInit): RequestRecord["operation"] {
  const envelope: unknown = JSON.parse(String(init?.body));
  const messages = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(envelope).messages;
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  if (system.includes("你是独立的答案暴露检查员")) return "disclosure_review";
  if (system.includes("你是学习内容可用性复核模块")) return "content_review";
  if (system.includes("你是学习反馈质量复核模块")) return "teaching_review";
  if (system.includes("学习诊断模块")) return "report";
  return "generation";
}
function fetcher(scenario: string, turn: number) {
  return async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const started = performance.now();
    const record: RequestRecord = { scenario, turn, operation: operationOf(init), elapsedMs: 0, status: null, finishReason: null, totalTokens: null, transportFailure: false };
    requests.push(record);
    try {
      const response = await fetch(url, init);
      record.status = response.status;
      const parsed = responseSchema.safeParse(await response.clone().json().catch(() => null));
      if (parsed.success) {
        record.finishReason = parsed.data.choices?.[0]?.finish_reason ?? null;
        record.totalTokens = parsed.data.usage?.total_tokens ?? null;
        const content = parsed.data.choices?.[0]?.message.content;
        if (content && (record.operation === "generation" || record.operation === "content_review")) {
          try {
            const selected = (record.operation === "generation" ? coachTurnSchema : auditSchema).safeParse(JSON.parse(content));
            if (selected.success) drafts.push({ scenario, turn, content: selected.data });
          } catch { /* Observe selected JSON only, never raw reasoning or transport headers. */ }
        }
      }
      return response;
    } catch (error) {
      record.transportFailure = true;
      throw error;
    } finally { record.elapsedMs = Math.round(performance.now() - started); }
  };
}

describe("cross-subject calibration fixtures", () => {
  it("keeps teacher approval separate from reproducible synthetic checks", () => {
    expect(fixtures.reviewStatus).toBe("PENDING_TEACHER_REVIEW");
    expect(new Set(fixtures.cases.map((item) => item.id)).size).toBe(3);
    expect(fixtures.cases.every((item) => item.turns.length >= 3)).toBe(true);
  });
});

describe.skipIf(!enabled)("real multi-turn teaching calibration", () => {
  beforeAll(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false");
    vi.stubEnv("AI_MAX_RETRIES", "1");
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "60000");
    resetServerEnvForTests();
  });
  afterAll(async () => {
    await mkdir(".data/coaching-live", { recursive: true });
    const generatedAt = new Date().toISOString();
    const successful = turns.filter((turn) => turn.automaticChecksPassed).map((turn) => turn.elapsedMs);
    await writeFile(`.data/coaching-live/calibration-${generatedAt.replace(/[:.]/gu, "-")}.json`, JSON.stringify({
      generatedAt, model: process.env.DEEPSEEK_MODEL, reviewStatus: fixtures.reviewStatus,
      evidenceScope: "真实模型处理合成的跨学科连续对话；前轮真实问题进入后轮上下文，学生回答为预设回放，未声称自适应真实学生作答。仅替换用量日志存储，不模拟任何模型输出。自动合同通过仍需教师按检查表复核；不代表教学成效。",
      reviewChecklist: fixtures.reviewChecklist, turns, reports, requests, drafts, usage: telemetry.usage,
      timing: {
        measuredSuccessfulTurns: successful.length,
        minMs: successful.length ? Math.min(...successful) : null,
        maxMs: successful.length ? Math.max(...successful) : null,
        meanMs: successful.length ? Math.round(successful.reduce((a, b) => a + b, 0) / successful.length) : null,
        failedTurns: turns.filter((turn) => !turn.automaticChecksPassed).length,
        generationCalls: requests.filter((request) => request.operation === "generation").length,
        extraGenerationAttempts: requests.filter((request) => request.operation === "generation").length - turns.length,
        note: "小样本仅报告观测范围及均值，不外推生产P95或SLA；失败及重试保留。",
      },
    }, null, 2), "utf8");
    vi.unstubAllEnvs(); resetServerEnvForTests();
  });
  it.each(fixtures.cases)("replays $id with real prior questions and evidence", async (fixture) => {
    const messages: CoachTurnInput["messages"] = [];
    let state: CoachTurnInput["learnerState"] = null;
    let unknownStreak = 0;
    for (const [index, turn] of fixture.turns.entries()) {
      const record: TurnRecord = { scenario: fixture.id, turn: index + 1, answer: turn.answer, intent: turn.intent, elapsedMs: 0, output: null, errorCode: null, automaticChecksPassed: false };
      turns.push(record);
      const started = performance.now();
      unknownStreak = turn.intent === "unknown" ? unknownStreak + 1 : 0;
      messages.push({ role: "USER", phase: "SOCRATIC", content: turn.answer, questionType: null });
      try {
        const output = await new DeepSeekProvider({ fetcher: fetcher(fixture.id, index + 1) }).createCoachTurn({
          task: fixture.task, phase: "SOCRATIC", socraticTurns: index, maxTurns: 5,
          unknownStreak, learnerState: state, latestAnswer: turn.answer, messages, knowledgePolicy: "MODEL_FALLBACK",
        });
        record.output = output;
        const feedback = learningFeedbackSchema.parse(output.learningFeedback);
        expect(turn.answer).toContain(feedback.answerQuote);
        expect(output.assistantMessage.match(/[?？]/gu)).toHaveLength(1);
        if (turn.intent === "unknown") expect(output.questionType).toBe("SCAFFOLDED_HINT");
        if (index === 0) expect(feedback.progress).toBeNull();
        expect(`${feedback.observation} ${feedback.whyItMatters}`).not.toMatch(/这么简单.*还不会|你没有学习能力/u);
        const previousQuestion = messages.filter((message) => message.role === "ASSISTANT").at(-1)?.content;
        if (previousQuestion) expect(output.assistantMessage).not.toBe(previousQuestion);
        record.automaticChecksPassed = true;
        state = output.learnerState;
        messages.push({ role: "ASSISTANT", phase: "SOCRATIC", content: output.assistantMessage, questionType: output.questionType });
      } catch (error) {
        record.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "CHECK_OR_PROVIDER_FAILURE";
        throw error;
      } finally { record.elapsedMs = Math.round(performance.now() - started); }
    }
    if (fixture.id === "science-repeated-unknown") {
      const explanation = "我只观察到冰逐渐变成水，还没说清温度不变时是否吸热，也没有举新情境。";
      const output = await new DeepSeekProvider({ fetcher: fetcher(fixture.id, 4) }).createLearningReport({
        task: fixture.task, messages: [...messages, { role: "USER", phase: "FEYNMAN", content: explanation, questionType: null }], feynmanExplanation: explanation,
      });
      reports.push({ scenario: fixture.id, output });
      expect(output.dimensions.transferAbility.score).toBeLessThanOrEqual(25);
      expect(output.dimensions.transferAbility.evidence).toMatch(/未|没有|不足|尚/u);
      expect(JSON.stringify(output)).not.toMatch(/你不具备迁移能力|学生不会迁移|智力低下/u);
    }
  }, 720_000);

  it("replays the observed evaporation browser answer with real review diagnostics", async () => {
    const scenario = "browser-evaporation-revision";
    const answer = "水量会减少。依据是：水在未沸腾时也会蒸发，蒸发发生在液体表面，20°C下仍能进行；敞口放置几天，水分子会逐渐进入空气。题目已排除漏水、泼洒，所以水量减少可主要用蒸发解释。";
    const previousQuestion = "在一个敞口杯中加入一定量水，放在20°C的房间里，不加热、不沸腾，也没有漏水和泼洒；几天后你预计水量会怎样变化，依据是什么？";
    const record: TurnRecord = { scenario, turn: 2, answer, intent: "revision", elapsedMs: 0, output: null, errorCode: null, automaticChecksPassed: false };
    const started = performance.now(); turns.push(record);
    try {
      record.output = await new DeepSeekProvider({ fetcher: fetcher(scenario, 2) }).createCoachTurn({
        task: createSessionInputSchema.parse({ topic: "蒸发与温度", objective: "通过日常现象说明水在未沸腾时也能蒸发，并区分蒸发和沸腾。", learnerLevel: "入门", referenceText: "蒸发是液体表面变为气体的现象，在水未沸腾时也能发生。沸腾是达到相应气压下沸点后在液体内部和表面同时发生的剧烈汽化。比较相同环境中等量水时，可以观察水量是否减少，但应排除漏水、泼洒等原因。蒸发通常受液体温度、表面积和表面空气流动影响。不能仅凭看到白雾就认为看到了水蒸气。" }),
        phase: "SOCRATIC", socraticTurns: 0, maxTurns: 5, unknownStreak: 0, learnerState: null,
        latestAnswer: answer, knowledgePolicy: "MODEL_FALLBACK", messages: [
          { role: "ASSISTANT", phase: "DIAGNOSIS", content: "如果暂时说不清，也可以直接说“不知道”。先用自己的话说说：关于这个知识点，你现在认为最重要的一点是什么？", questionType: "CONCEPT_CLARIFICATION" },
          { role: "USER", phase: "DIAGNOSIS", content: "我认为水只有烧开了才会变成水蒸气，所以常温下不会变少。", questionType: null },
          { role: "ASSISTANT", phase: "SOCRATIC", content: previousQuestion, questionType: "ASSUMPTION_TEST" },
          { role: "USER", phase: "SOCRATIC", content: answer, questionType: null },
        ],
      });
      expect(answer).toContain(record.output.learningFeedback!.answerQuote);
      record.automaticChecksPassed = true;
    } catch (error) {
      record.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "CHECK_OR_PROVIDER_FAILURE";
      throw error;
    } finally { record.elapsedMs = Math.round(performance.now() - started); }
  }, 240_000);
});
