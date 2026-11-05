import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { coachTurnSchema, createSessionInputSchema, learnerStateSchema, learningPhaseSchema, messageRoleSchema, questionTypeSchema } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";
import source from "./comparison-consistency-observed.json";

vi.mock("@/lib/db", () => ({ prisma: { aIUsage: { create: async () => ({ id: "comparison-consistency-review" }) } } }));
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && process.env.RUN_COMPARISON_CONSISTENCY_LIVE === "true";
const input = z.object({ task: createSessionInputSchema, phase: learningPhaseSchema, socraticTurns: z.number(), maxTurns: z.number(), unknownStreak: z.number(),
  learnerState: learnerStateSchema.nullable(), latestAnswer: z.string(), knowledgePolicy: z.literal("MODEL_FALLBACK"),
  messages: z.array(z.object({ role: messageRoleSchema, phase: learningPhaseSchema, content: z.string(), questionType: questionTypeSchema.nullable() })),
}).parse(source.input);
const original = coachTurnSchema.parse(source.candidate);
const fixtures = [
  { id: "observed-identical-cups-different-mouths", expected: "INCONSISTENT_GIVENS", candidate: original },
  { id: "controlled-water-environment-different-surface", expected: "PASS", candidate: coachTurnSchema.parse({ ...original,
    assistantMessage: "A、B两个敞口杯中的水量、液体温度、空气流动和放置时间都相同，均无漏水、泼洒或沸腾；A杯杯口较窄、水面面积较小，B杯杯口较宽、水面面积较大，哪杯水减少得更多，依据是什么？",
  }) },
] as const;
type Json = z.infer<ReturnType<typeof z.json>>;
const records: Array<{ id: string; expected: string; candidate: Json; accepted: boolean; error: string | null; requests: Array<{ operation: string; elapsedMs: number; status: number; rawContent: string | null; content: Json | null }> }> = [];
let sourceFingerprint = "";

describe.skipIf(!enabled)("real controlled-comparison consistency review", () => {
  beforeAll(async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek"); vi.stubEnv("DEPLOYMENT_ENV", "test"); vi.stubEnv("AI_MAX_RETRIES", "0"); vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false"); resetServerEnvForTests();
    const sourceFiles = await Promise.all(["src/lib/ai/deepseek-provider.ts", "src/lib/ai/prompts/tutor.ts", "src/lib/ai/answer-disclosure-audit.ts", "src/lib/ai/triangle-constraints.ts"].map((path) => readFile(path, "utf8")));
    sourceFingerprint = createHash("sha256").update(sourceFiles.join("\n")).digest("hex");
  });
  afterAll(async () => {
    await mkdir(".data/multi-session-live", { recursive: true });
    await writeFile(`.data/multi-session-live/comparison-consistency-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`, JSON.stringify({ source: source.sourceArtifact, sourceFingerprint, model: process.env.DEEPSEEK_MODEL,
      scope: "Two fixed synthetic candidates, generation injected; content/disclosure/teaching audits use real HTTP. Candidate and input remain fixed. No teacher certification or production reliability claim.", input, records }, null, 2));
    vi.unstubAllEnvs(); resetServerEnvForTests();
  });
  for (const fixture of fixtures) it(fixture.id, async () => {
    const record: (typeof records)[number] = { id: fixture.id, expected: fixture.expected, candidate: z.json().parse(fixture.candidate), accepted: false, error: null, requests: [] };
    records.push(record);
    const fetcher: typeof fetch = async (url, init) => {
      const body = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(String(init?.body)));
      const system = body.messages[0]!.content;
      const operation = system.startsWith("你是学习内容可用性复核模块") ? "content" : system.startsWith("你是独立的答案暴露检查员") ? "disclosure" : system.startsWith("你是学习反馈质量复核模块") ? "teaching" : "generation";
      if (operation === "generation") return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fixture.candidate) } }] }), { status: 200 });
      const started = performance.now(); const response = await fetch(url, init);
      const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })) }).safeParse(await response.clone().json());
      const rawContent = envelope.success ? envelope.data.choices[0]?.message.content ?? null : null;
      let content: Json | null = null;
      if (rawContent) try { content = z.json().parse(JSON.parse(rawContent)); } catch { /* Keep raw failure. */ }
      record.requests.push({ operation, elapsedMs: Math.round(performance.now() - started), status: response.status, rawContent, content });
      return response;
    };
    try { await new DeepSeekProvider({ fetcher }).createCoachTurn(input); record.accepted = true; }
    catch (error) { record.error = error instanceof Error ? error.message : "UNKNOWN"; }
    expect(record.accepted).toBe(fixture.expected === "PASS");
    const content = z.object({ verdict: z.string(), inconsistentGivens: z.object({ quotes: z.array(z.string()) }).nullable() }).parse(record.requests.find((request) => request.operation === "content")?.content);
    expect(content.verdict).toBe(fixture.expected);
    if (fixture.expected !== "PASS") {
      expect(content.inconsistentGivens).not.toBeNull();
      const quotes = content.inconsistentGivens!.quotes;
      expect(quotes.some((quote) => quote.includes("相同"))).toBe(true);
      expect(quotes.some((quote) => quote.includes("较窄") || quote.includes("较宽"))).toBe(true);
      for (const quote of quotes) expect(fixture.candidate.assistantMessage).toContain(quote);
    }
  }, 90_000);
});
