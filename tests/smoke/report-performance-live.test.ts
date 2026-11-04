import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { resetServerEnvForTests } from "@/lib/env";
import { createSessionInputSchema, learnerStateSchema, learningPhaseSchema, questionTypeSchema } from "@/lib/contracts";
import type { FeynmanInstructionInput, ReportInput } from "@/lib/ai/types";

const telemetry = vi.hoisted(() => ({ usage: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db", () => ({ prisma: { aIUsage: {
  create: async (input: { data: Record<string, unknown> }) => {
    telemetry.usage.push(input.data);
    return { id: `report-performance-${telemetry.usage.length}`, ...input.data };
  },
} } }));

config({ path: [".env.local", ".env"], quiet: true });
// This opt-in experiment consumes a deliberately exported synthetic browser
// session. It never loads account data or changes provider configuration.
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && process.env.RUN_REPORT_PERFORMANCE_TEST === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const inputSchema = z.object({
  reportInput: z.object({
    task: createSessionInputSchema,
    messages: z.array(z.object({
      role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
      phase: learningPhaseSchema,
      content: z.string(),
      questionType: questionTypeSchema.nullable(),
    })),
    feynmanExplanation: z.string(), retrievedContext: z.array(z.string()).optional(),
  }),
  feynmanInput: z.object({ task: createSessionInputSchema, learnerState: learnerStateSchema.nullable() }),
});
const responseSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string().optional(), message: z.object({ content: z.string().nullable().optional() }) })).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
});
const runs: Array<{ scenario: string; elapsedMs: number; output: unknown; error: string | null }> = [];
const requests: Array<{ scenario: string; effort: unknown; elapsedMs: number; status: number | null; finishReason: string | null; completionTokens: number | null }> = [];
function observedFetcher(scenario: string, overrideReport: boolean) {
  return async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const envelope = z.record(z.string(), z.unknown()).parse(JSON.parse(String(init?.body)));
    if (overrideReport) envelope.reasoning_effort = "low";
    const record = { scenario, effort: envelope.reasoning_effort ?? null, elapsedMs: 0, status: null as number | null, finishReason: null as string | null, completionTokens: null as number | null };
    requests.push(record);
    const started = performance.now();
    try {
      const response = await fetch(url, { ...init, body: JSON.stringify(envelope) });
      record.status = response.status;
      const parsed = responseSchema.safeParse(await response.clone().json());
      if (parsed.success) {
        record.finishReason = parsed.data.choices?.[0]?.finish_reason ?? null;
        record.completionTokens = parsed.data.usage?.completion_tokens ?? null;
      }
      return response;
    } finally { record.elapsedMs = Math.round(performance.now() - started); }
  };
}

describe.skipIf(!enabled)("same-input real report performance experiment", () => {
  let reportInput: ReportInput;
  let feynmanInput: FeynmanInstructionInput;
  beforeAll(async () => {
    const inputPath = process.env.REPORT_PERFORMANCE_INPUT_PATH;
    if (!inputPath) throw new Error("Export a synthetic browser input and set REPORT_PERFORMANCE_INPUT_PATH.");
    const inputs = inputSchema.parse(JSON.parse(await readFile(inputPath, "utf8")));
    reportInput = inputs.reportInput;
    feynmanInput = inputs.feynmanInput;
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
    await writeFile(`.data/coaching-live/report-performance-${generatedAt.replace(/[:.]/gu, "-")}.json`, JSON.stringify({ generatedAt, model: process.env.DEEPSEEK_MODEL, scope: "Same synthetic browser conversation; report requests override only reasoning_effort=low. Original Zod and quoted-student evidence gates remain active. This small comparison is not an SLA or teacher approval.", runs, requests, usage: telemetry.usage }, null, 2));
    vi.unstubAllEnvs(); resetServerEnvForTests();
  });
  it.each([1, 2])("checks low effort report replay %i with original evidence gates", async (index) => {
    const scenario = `report-low-${index}`;
    const record = { scenario, elapsedMs: 0, output: null as unknown, error: null as string | null };
    runs.push(record);
    const started = performance.now();
    try {
      record.output = await new DeepSeekProvider({ fetcher: observedFetcher(scenario, true) }).createLearningReport(reportInput);
      expect(record.output).toBeTruthy();
    } catch (error) {
      record.error = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      throw error;
    } finally { record.elapsedMs = Math.round(performance.now() - started); }
  }, 240_000);
  it("uses a neutral Feynman phase instruction without a model request", async () => {
    const scenario = "neutral-feynman";
    const started = performance.now();
    const output = await new DeepSeekProvider({ fetcher: observedFetcher(scenario, false) }).createFeynmanInstruction(feynmanInput);
    runs.push({ scenario, elapsedMs: Math.round(performance.now() - started), output, error: null });
    expect(output.assistantMessage).toMatch(/^请/u);
    expect(output.assistantMessage).not.toMatch(/你之前已经能|你已经掌握|你已掌握|你已能/u);
    expect(requests.filter((request) => request.scenario === scenario)).toHaveLength(0);
  }, 120_000);
});
