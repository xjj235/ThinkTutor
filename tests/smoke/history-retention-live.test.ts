import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { coachSystemPrompt } from "@/lib/ai/prompts";
import { coachTurnSchema, createSessionInputSchema, learnerStateSchema, learningPhaseSchema, messageRoleSchema, questionTypeSchema } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";
import type { CoachTurnInput } from "@/lib/ai/types";
import observed from "./history-retention-observed.json";

vi.mock("@/lib/db", () => ({ prisma: { aIUsage: { create: async () => ({ id: "history-retention-telemetry" }) } } }));
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && process.env.RUN_HISTORY_RETENTION_LIVE === "true";
const inputSchema = z.object({
  task: createSessionInputSchema, phase: z.literal("SOCRATIC"), socraticTurns: z.number().int(), maxTurns: z.number().int(), unknownStreak: z.number().int(),
  learnerState: learnerStateSchema.nullable(), latestAnswer: z.string(),
  messages: z.array(z.object({ role: messageRoleSchema, phase: learningPhaseSchema, content: z.string(), questionType: questionTypeSchema.nullable() })),
  knowledgePolicy: z.literal("MODEL_FALLBACK"),
});
const original = inputSchema.parse(observed.input);
const earlierAnswer = "记录直接写了桥修好以后两岸通行更方便，没有写出资者，不能确定是谁付的钱。";
const latestAnswer = "我能补查有署名的账册核对出资者。没有姓名不等于没人出资，当前这段材料仍不足以确定。";
const variants: Array<{ id: string; input: CoachTurnInput; semanticChecks: string[] }> = [
  { id: "observed-canal-recall-regression", input: original, semanticChecks: observed.semanticChecks },
  { id: "new-bridge-source-evidence", input: {
    task: createSessionInputSchema.parse({ topic: "史料记录与推断", objective: "区分直接记录、推断和资料不足，并说明依据", learnerLevel: "入门", referenceText: "一段地方记录写道：桥修好后，两岸居民通行更方便。片段没有出资者姓名。只依据所给材料判断，不编造人名。" }),
    phase: "SOCRATIC", socraticTurns: 0, maxTurns: 5, unknownStreak: 0, knowledgePolicy: "MODEL_FALLBACK", latestAnswer,
    learnerState: { masteryEstimate: 35, confirmedPoints: ["读出修桥后通行更方便", "指出材料没有提供出资者姓名"], gaps: ["尚未说明判断直接记录和推断的依据"], misconceptions: [] },
    messages: [
      { role: "ASSISTANT", phase: "DIAGNOSIS", content: "这段材料能让你确定什么？", questionType: "CONCEPT_CLARIFICATION" },
      { role: "USER", phase: "DIAGNOSIS", content: earlierAnswer, questionType: null },
      { role: "ASSISTANT", phase: "SOCRATIC", content: "你读出的事实为什么属于直接记录，而不是你自己的推断？", questionType: "EVIDENCE_PROBE" },
      { role: "USER", phase: "SOCRATIC", content: latestAnswer, questionType: null },
    ],
  }, semanticChecks: ["承认前轮已说出通行更方便，不要求仅重述该事实", "可再次追问尚未回答的分类依据，但不能声称事实未说", "不从无署名推断没有出资者，也不编造姓名"] },
];
type Json = z.infer<ReturnType<typeof z.json>>;
const records: Array<{ id: string; input: Json; semanticChecks: string[]; status: string; output: Json | null; error: string | null; requests: Array<{ operation: string; elapsedMs: number; httpStatus: number; rawContent: string | null; finishReason: string | null }> }> = [];

describe.skipIf(!enabled)("real history retention replay", () => {
  beforeAll(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek"); vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false"); vi.stubEnv("AI_MAX_RETRIES", "1");
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "60000"); resetServerEnvForTests();
  });
  afterAll(async () => {
    await mkdir(".data/multi-session-live", { recursive: true });
    const path = `.data/multi-session-live/history-retention-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`;
    await writeFile(path, JSON.stringify({ model: process.env.DEEPSEEK_MODEL, promptSha256: createHash("sha256").update(coachSystemPrompt).digest("hex"),
      scope: "All generation and audits are real HTTP; fixed synthetic histories. Contract assertions do not establish semantic quality. Independently review outputs and failed drafts; not teacher certification.", semanticReview: "PENDING_INDEPENDENT_SEMANTIC_REVIEW", records }, null, 2));
    vi.unstubAllEnvs(); resetServerEnvForTests();
  });
  for (const fixture of variants) it(fixture.id, async () => {
    const record: (typeof records)[number] = { id: fixture.id, input: z.json().parse(fixture.input), semanticChecks: fixture.semanticChecks, status: "RUNNING", output: null, error: null, requests: [] };
    records.push(record);
    const fetcher: typeof fetch = async (url, init) => {
      const body = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(String(init?.body)));
      const system = body.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      const operation = system.startsWith("你是独立的答案暴露检查员") ? "disclosure" : system.startsWith("你是学习内容可用性复核模块") ? "content" : system.startsWith("你是学习反馈质量复核模块") ? "teaching" : "generation";
      const started = performance.now();
      const response = await fetch(url, init);
      const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullish(), message: z.object({ content: z.string().nullish() }) })) }).safeParse(await response.clone().json());
      record.requests.push({ operation, elapsedMs: Math.round(performance.now() - started), httpStatus: response.status,
        rawContent: envelope.success ? envelope.data.choices[0]?.message.content ?? null : null, finishReason: envelope.success ? envelope.data.choices[0]?.finish_reason ?? null : null });
      return response;
    };
    try {
      const output = await new DeepSeekProvider({ fetcher }).createCoachTurn(fixture.input);
      record.output = z.json().parse(output); record.status = "CONTRACT_PASSED_SEMANTIC_REVIEW_PENDING";
      expect(coachTurnSchema.safeParse(output).success).toBe(true);
      expect(fixture.input.latestAnswer?.includes(output.learningFeedback!.answerQuote)).toBe(true);
      expect(record.requests.some((request) => request.operation === "teaching")).toBe(true);
    } catch (error) { record.status = "FAILED"; record.error = error instanceof Error ? error.message : "UNKNOWN"; throw error; }
  }, 150_000);
});
