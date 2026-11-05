import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { coachTurnSchema, createSessionInputSchema, learnerStateSchema, learningPhaseSchema, questionTypeSchema } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";
import source from "./counterfactual-source-replay.json";

vi.mock("@/lib/db", () => ({ prisma: { aIUsage: { create: async () => ({ id: "fixed-source-review" }) } } }));
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && process.env.RUN_COUNTERFACTUAL_SOURCE_REPLAY === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const inputSchema = z.object({
  task: createSessionInputSchema, phase: learningPhaseSchema, socraticTurns: z.number(), maxTurns: z.number(), unknownStreak: z.number(),
  learnerState: learnerStateSchema.nullable(), latestAnswer: z.string(), knowledgePolicy: z.literal("MODEL_FALLBACK"),
  messages: z.array(z.object({ role: z.enum(["USER", "ASSISTANT", "SYSTEM"]), phase: learningPhaseSchema, content: z.string(), questionType: questionTypeSchema.nullable() })),
});
const input = inputSchema.parse(source.input);
const records: Array<{ candidate: z.infer<typeof coachTurnSchema>; accepted: boolean; error: string | null; requests: Array<{ operation: string; elapsedMs: number; content: z.infer<ReturnType<typeof z.json>> | null }> }> = [];
describe.skipIf(!enabled)("real counterfactual source replay", () => {
  beforeAll(() => { vi.stubEnv("AI_PROVIDER", "deepseek"); vi.stubEnv("DEPLOYMENT_ENV", "test"); vi.stubEnv("AI_MAX_RETRIES", "0"); vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false"); resetServerEnvForTests(); });
  afterAll(async () => {
    await mkdir(".data/coaching-live", { recursive: true });
    await writeFile(`.data/coaching-live/counterfactual-source-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`, JSON.stringify({ source: source.source, scope: "Original synthetic history and two fixed generated candidates; all three audits are live; no teacher certification.", input, records }, null, 2));
    vi.unstubAllEnvs(); resetServerEnvForTests();
  });
  for (const [index, rawCandidate] of source.candidates.entries()) it(`accepts original valid candidate ${index + 1} with grounded logical premises`, async () => {
    // Match production parseStructuredPayload: webSources is an envelope field,
    // while the student-visible candidate and its teaching metadata stay exact.
    const candidate = coachTurnSchema.parse(Object.fromEntries(Object.entries(rawCandidate).filter(([key]) => key !== "webSources")));
    const record: (typeof records)[number] = { candidate, accepted: false, error: null, requests: [] }; records.push(record);
    const fetcher: typeof fetch = async (url, init) => {
      const body = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(String(init?.body)));
      const system = body.messages[0]!.content;
      const operation = system.startsWith("你是学习内容可用性复核模块") ? "content" : system.startsWith("你是独立的答案暴露检查员") ? "disclosure" : system.startsWith("你是学习反馈质量复核模块") ? "teaching" : "generation";
      if (operation === "generation") return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200 });
      const started = performance.now(); const response = await fetch(url, init);
      const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })) }).parse(await response.clone().json());
      let content: (typeof record.requests)[number]["content"] = null;
      try { content = z.json().parse(JSON.parse(envelope.choices[0]?.message.content ?? "")); } catch { /* Retain failure without altering provider handling. */ }
      record.requests.push({ operation, elapsedMs: Math.round(performance.now() - started), content });
      return response;
    };
    try { await new DeepSeekProvider({ fetcher }).createCoachTurn(input); record.accepted = true; }
    catch (error) { record.error = error instanceof Error ? error.message : "UNKNOWN"; }
    expect(record.accepted).toBe(true);
    const audit = z.object({ counterfactualEvidence: z.object({ studentClaimQuote: z.string(), conditions: z.array(z.object({ studentQuote: z.string() })) }) }).parse(record.requests.find((request) => request.operation === "teaching")?.content);
    expect(input.latestAnswer).toContain(audit.counterfactualEvidence.studentClaimQuote);
    for (const condition of audit.counterfactualEvidence.conditions) expect(audit.counterfactualEvidence.studentClaimQuote).toContain(condition.studentQuote);
  }, 90_000);
});
