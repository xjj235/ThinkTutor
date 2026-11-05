import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { coachTurnSchema, createSessionInputSchema, learnerStateSchema, learningPhaseSchema, questionTypeSchema } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";
import { AIProviderError } from "@/lib/errors";
import source from "./content-format-repair-replay.json";

const telemetry = vi.hoisted(() => ({ usage: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db", () => ({ prisma: { aIUsage: {
  create: async (input: { data: Record<string, unknown> }) => {
    telemetry.usage.push(input.data);
    return { id: `format-repair-${telemetry.usage.length}`, ...input.data };
  },
} } }));

config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true"
  && process.env.RUN_CONTENT_FORMAT_REPAIR_REPLAY === "true"
  && Boolean(process.env.DEEPSEEK_API_KEY);
const inputSchema = z.object({
  task: createSessionInputSchema,
  phase: learningPhaseSchema,
  socraticTurns: z.number(),
  maxTurns: z.number(),
  unknownStreak: z.number(),
  learnerState: learnerStateSchema.nullable(),
  latestAnswer: z.string(),
  knowledgePolicy: z.literal("MODEL_FALLBACK"),
  messages: z.array(z.object({
    role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
    phase: learningPhaseSchema,
    content: z.string(),
    questionType: questionTypeSchema.nullable(),
  })),
});
const input = inputSchema.parse(source.input);
const candidate = coachTurnSchema.parse(source.candidate);
const invalidContent = z.json().parse(source.invalidContent);
const requestSchema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) });
const responseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable() }),
  })),
});

type Operation = "generation" | "content" | "disclosure" | "teaching";
interface RequestRecord {
  operation: Operation;
  origin: "injected_generation" | "injected_invalid_content" | "blocked_regeneration" | "real_http";
  elapsedMs: number;
  httpStatus: number | null;
  finishReason: string | null;
  modelContent: string | null;
  transportFailure: boolean;
}
const requests: RequestRecord[] = [];
const contentPayloads: string[] = [];
let generationCalls = 0;
let contentCalls = 0;
let accepted = false;
let errorCode: string | null = null;
let errorMessage: string | null = null;
let elapsedMs = 0;

function operationOf(system: string): Operation {
  if (system.startsWith("你是学习内容可用性复核模块")) return "content";
  if (system.startsWith("你是独立的答案暴露检查员")) return "disclosure";
  if (system.startsWith("你是学习反馈质量复核模块")) return "teaching";
  return "generation";
}

function completion(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
}

describe.skipIf(!enabled)("original content format failure with one live repair", () => {
  beforeAll(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("AI_MAX_RETRIES", "1");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false");
    resetServerEnvForTests();
  });

  afterAll(async () => {
    await mkdir(".data/coaching-live", { recursive: true });
    const date = new Date().toISOString();
    await writeFile(`.data/coaching-live/content-format-repair-${date.replace(/[:.]/gu, "-")}.json`, JSON.stringify({
      date,
      source: source.source,
      scope: "Original synthetic input, original candidate and first malformed content response are injected. Disclosure, one content repair and teaching audit use real HTTP. Further generation is blocked and counted as failure.",
      input,
      candidate,
      invalidContent,
      accepted,
      errorCode,
      errorMessage,
      elapsedMs,
      generationCalls,
      contentCalls,
      sameContentPayload: contentPayloads.length === 2 && contentPayloads[0] === contentPayloads[1],
      requests,
      usage: telemetry.usage,
    }, null, 2));
    vi.unstubAllEnvs();
    resetServerEnvForTests();
  });

  it("repairs the original partial triangle object once and actually accepts the same candidate", async () => {
    const fetcher: typeof fetch = async (url, init) => {
      const body = requestSchema.parse(JSON.parse(String(init?.body)));
      const operation = operationOf(body.messages[0]!.content);
      const record: RequestRecord = {
        operation, origin: "real_http", elapsedMs: 0, httpStatus: null,
        finishReason: null, modelContent: null, transportFailure: false,
      };
      requests.push(record);
      if (operation === "generation") {
        generationCalls += 1;
        if (generationCalls > 1) {
          record.origin = "blocked_regeneration";
          throw new Error("The original fixed candidate must not regenerate during this replay.");
        }
        record.origin = "injected_generation";
        record.modelContent = JSON.stringify(candidate);
        record.httpStatus = 200;
        return completion(candidate);
      }
      if (operation === "content") {
        contentCalls += 1;
        contentPayloads.push(body.messages.at(-1)!.content);
        if (contentCalls === 1) {
          record.origin = "injected_invalid_content";
          record.modelContent = JSON.stringify(invalidContent);
          record.httpStatus = 200;
          return completion(invalidContent);
        }
      }
      const started = performance.now();
      try {
        const response = await fetch(url, init);
        record.httpStatus = response.status;
        try {
          const envelope = responseSchema.safeParse(await response.clone().json());
          if (envelope.success) {
            record.modelContent = envelope.data.choices[0]?.message.content ?? null;
            record.finishReason = envelope.data.choices[0]?.finish_reason ?? null;
          }
        } catch { /* The provider owns output parsing and rejection. */ }
        return response;
      } catch (error) {
        record.transportFailure = true;
        throw error;
      } finally {
        record.elapsedMs = Math.round(performance.now() - started);
      }
    };
    const started = performance.now();
    try {
      const output = await new DeepSeekProvider({ fetcher }).createCoachTurn({
        ...input,
        requestId: `content-format-replay-${crypto.randomUUID()}`,
      });
      accepted = output.assistantMessage === candidate.assistantMessage;
    } catch (error) {
      errorCode = error instanceof AIProviderError ? error.code : "UNKNOWN";
      errorMessage = error instanceof Error ? error.message : "UNKNOWN";
    } finally {
      elapsedMs = Math.round(performance.now() - started);
    }
    expect(generationCalls).toBe(1);
    expect(contentCalls).toBe(2);
    expect(contentPayloads[1]).toBe(contentPayloads[0]);
    expect(requests.filter((request) => request.origin === "real_http")).toHaveLength(3);
    expect(telemetry.usage.filter((usage) => usage.operation === "coach_content_review")).toEqual([
      expect.objectContaining({ status: "SUCCESS", retryCount: 1 }),
    ]);
    expect(accepted).toBe(true);
  });
});
