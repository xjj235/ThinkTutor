import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { resetServerEnvForTests } from "@/lib/env";
import { coachTurnSchema, createSessionInputSchema, dimensionKeys, learningReportDraftSchema } from "@/lib/contracts";
import { learningFeedbackSchema } from "@/lib/learning-feedback";
import { finalizeReportDraft } from "@/lib/scoring";
import { linkReportEvidence, type ReportEvidenceLinks } from "@/lib/knowledge/report-evidence";
import type { CoachTurnInput, ReportInput, SourcedCoachTurn } from "@/lib/ai/types";
import cases from "./multi-session-cases.json";

const usageSchema = z.object({
  provider: z.string(), model: z.string(), operation: z.string(), sessionId: z.string().nullish(),
  requestId: z.string().nullish(), status: z.string(), latencyMs: z.number(), retryCount: z.number(),
  promptTokens: z.number().nullish(), completionTokens: z.number().nullish(), cacheHitTokens: z.number().nullish(), errorCode: z.string().nullish(),
});
const telemetry = vi.hoisted(() => ({ usage: [] as unknown[] }));
// Only telemetry persistence is replaced. Generation AND all reviews use fetch.
vi.mock("@/lib/db", () => ({ prisma: { aIUsage: {
  create: async (input: { data: unknown }) => {
    telemetry.usage.push(input.data);
    return { id: `multi-session-usage-${telemetry.usage.length}` };
  },
} } }));

config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && process.env.RUN_MULTI_SESSION_LIVE === "true";
const fixtureSchema = z.object({
  version: z.literal(1), reviewStatus: z.literal("PENDING_INDEPENDENT_SEMANTIC_REVIEW"), scope: z.string(),
  cases: z.array(z.object({ id: z.string(), task: createSessionInputSchema,
    turns: z.array(z.object({ intent: z.enum(["misconception", "revision", "unknown", "injection", "insufficient_material"]), answer: z.string().min(1) })).length(2),
    semanticChecks: z.array(z.string()).min(3),
  })).length(6),
});
const fixtures = fixtureSchema.parse(cases);
const batch = z.enum(["baseline", "final", "sequential", "long", "nonthinking-first"]).parse(process.env.MULTI_SESSION_BATCH ?? "baseline");
const concurrency = z.coerce.number().int().refine((value) => value === 1 || value === 3).parse(process.env.MULTI_SESSION_CONCURRENCY ?? "3");
// Optional bounded follow-up, outside the identical 6 x 2 performance comparison.
const longReplies: Fixture["turns"] = [
  { intent: "misconception", answer: "我看见开始是固体冰，后来冰变少、液态水变多。不过温度计一直没变，所以我认为这段时间没有吸热。" },
  { intent: "revision", answer: "我修正刚才温度不变就没有吸热的说法。物态可以是固态和液态，冰逐渐变成水是熔化过程。温度不变是另一条观察，不能直接当作没有吸热的证据；资料说纯冰熔化期间仍持续吸热。" },
  { intent: "revision", answer: "我修正了：在材料限定的通常大气压和纯冰条件下，熔化期间虽然温度可保持0摄氏度，冰仍在持续吸热并变成水。需要同时记录温度和物态，不能只看温度就判断是否吸热。" },
];
const selectedFixtures = batch === "long" ? [{ ...fixtures.cases[1], id: "melting-five-turns", turns: [...fixtures.cases[1].turns, ...longReplies] }]
  : batch === "nonthinking-first" ? fixtures.cases.map((fixture) => ({ ...fixture, turns: fixture.turns.slice(0, 1) })) : fixtures.cases;
const scheduledTurns = selectedFixtures.reduce((count, fixture) => count + fixture.turns.length, 0);
const requestSchema = z.object({ model: z.string(), max_tokens: z.number(), temperature: z.number().optional(), reasoning_effort: z.string().optional(), thinking: z.object({ type: z.string() }).optional(), messages: z.array(z.object({ role: z.string(), content: z.string() })) });
const responseSchema = z.object({
  model: z.string().optional(), choices: z.array(z.object({ finish_reason: z.string().nullish(), message: z.object({ content: z.string().nullish() }) })).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional(), prompt_cache_hit_tokens: z.number().optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).optional() }).optional(),
});
type Fixture = (typeof fixtures.cases)[number];
interface RequestRecord {
  sessionId: string; scenario: string; turn: number; requestId: string; operation: string; attempt: number;
  startedAt: string; elapsedMs: number; httpStatus: number | null; model: string; responseModel: string | null;
  thinking: string | null; reasoningEffort: string | null; finishReason: string | null;
  maxTokens: number; temperature: number | null; reasoningTokens: number | null;
  promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; cacheHitTokens: number | null;
  modelContent: string | null; transportFailure: boolean;
}
interface TurnRecord {
  turn: number; requestId: string; intent: string; answer: string; previousQuestion: string;
  input: CoachTurnInput; startedAt: string; elapsedMs: number; output: SourcedCoachTurn | null;
  status: "RUNNING" | "AUTOMATIC_CHECKS_PASSED" | "FAILED" | "BLOCKED_PREVIOUS_FAILURE";
  errorCode: string | null;
}
interface SessionRecord {
  sessionId: string; scenario: string; task: Fixture["task"]; semanticChecks: string[];
  semanticReview: "PENDING_INDEPENDENT_SEMANTIC_REVIEW"; turns: TurnRecord[];
  closing?: {
    requestId: string; instruction: Awaited<ReturnType<DeepSeekProvider["createFeynmanInstruction"]>>;
    explanation: string; input: ReportInput; elapsedMs: number;
    report: ReturnType<typeof finalizeReportDraft> | null; evidenceLinks: ReportEvidenceLinks | null;
    oldMisconceptionGapMatches: string[];
    status: "RUNNING" | "AUTOMATIC_CHECKS_PASSED" | "FAILED"; errorCode: string | null;
  };
}
const sessions: SessionRecord[] = [];
const requests: RequestRecord[] = [];
let activeHttp = 0;
let maxActiveHttp = 0;
let activeSessions = 0;
let maxActiveSessions = 0;
let artifactPath = "";
let startedAt = "";
let sourceFingerprint = "";
let writeQueue = Promise.resolve();
const percentile = (values: number[], quantile: number) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * quantile) - 1)] : null;
function timing() {
  const turns = sessions.flatMap((session) => session.turns);
  const attempted = turns.filter((turn) => turn.status !== "BLOCKED_PREVIOUS_FAILURE" && turn.status !== "RUNNING");
  const completed = attempted.filter((turn) => turn.status === "AUTOMATIC_CHECKS_PASSED").map((turn) => turn.elapsedMs);
  const failed = attempted.filter((turn) => turn.status === "FAILED");
  return { attempted: attempted.length, automaticPassed: completed.length, failed: failed.length,
    blocked: turns.filter((turn) => turn.status === "BLOCKED_PREVIOUS_FAILURE").length,
    failureRate: attempted.length ? failed.length / attempted.length : null,
    successfulTurns: { p50Ms: percentile(completed, .5), p90Ms: percentile(completed, .9), maxMs: completed.length ? Math.max(...completed) : null },
    allAttemptedTurns: { p50Ms: percentile(attempted.map((turn) => turn.elapsedMs), .5), p90Ms: percentile(attempted.map((turn) => turn.elapsedMs), .9), maxMs: attempted.length ? Math.max(...attempted.map((turn) => turn.elapsedMs)) : null },
    modelHttpCalls: requests.length, maxActiveHttp, maxActiveSessions,
    note: "Bounded synthetic turns. Observed sample percentiles, not production P95/SLA or learning efficacy. Failed/blocked turns are retained; semantic review is separate.",
  };
}
function persist(completed = false) {
  if (!artifactPath) return Promise.resolve();
  const snapshot = JSON.stringify({ startedAt, completedAt: completed ? new Date().toISOString() : null, batch,
    model: process.env.DEEPSEEK_MODEL, fixtureSha256: createHash("sha256").update(JSON.stringify(fixtures)).digest("hex"), sourceFingerprint,
    concurrency, settings: { maxRetries: 1, requestTimeoutMs: 60000, webSearchFallback: false, maxScheduledTurns: scheduledTurns },
    evidenceScope: fixtures.scope, semanticReview: fixtures.reviewStatus,
    experiment: batch === "nonthinking-first" ? { coachThinking: "disabled", removedReasoningEffort: true, otherRequestFieldsUnchanged: true, allReviewsRealAndUnchanged: true, firstReplyPerTopicOnly: true, scheduledSubmissions: 6, productionConfigurationChanged: false } : null,
    sessions, requests, usage: telemetry.usage.map((entry) => usageSchema.parse(entry)), timing: timing(),
  }, null, 2);
  writeQueue = writeQueue.then(() => writeFile(artifactPath, snapshot, "utf8"));
  return writeQueue;
}
async function fingerprint(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else { hash.update(relative(directory, path).replaceAll("\\", "/")); hash.update(await readFile(path)); }
    }
  }
  await visit(directory);
  return hash.digest("hex");
}
function observedFetch(session: SessionRecord, turn: Pick<TurnRecord, "turn" | "requestId">) {
  return async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const body = z.record(z.string(), z.unknown()).parse(JSON.parse(String(init?.body)));
    const input = requestSchema.parse(body);
    const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const operation = system.includes("你是独立的答案暴露检查员") ? "coach_disclosure_review"
      : system.includes("你是学习内容可用性复核模块") ? "coach_content_review"
        : system.includes("你是学习反馈质量复核模块") ? "coach_review"
          : system.includes("学习诊断模块") ? "report" : "coach";
    let actualInit = init;
    if (batch === "nonthinking-first" && operation === "coach") {
      expect(input.thinking?.type).toBe("enabled");
      expect(input.max_tokens).toBe(8000);
      // Experimental transport override only; preserve every other body field.
      body.thinking = { type: "disabled" };
      delete body.reasoning_effort;
      actualInit = { ...init, body: JSON.stringify(body) };
      input.thinking = { type: "disabled" };
      delete input.reasoning_effort;
    }
    const record: RequestRecord = { sessionId: session.sessionId, scenario: session.scenario, turn: turn.turn, requestId: turn.requestId, operation,
      attempt: requests.filter((request) => request.requestId === turn.requestId && request.operation === operation).length + 1,
      startedAt: new Date().toISOString(), elapsedMs: 0, httpStatus: null, model: input.model, responseModel: null,
      thinking: input.thinking?.type ?? null, reasoningEffort: input.reasoning_effort ?? null,
      maxTokens: input.max_tokens, temperature: input.temperature ?? null, reasoningTokens: null,
      finishReason: null, promptTokens: null, completionTokens: null, totalTokens: null, cacheHitTokens: null,
      modelContent: null, transportFailure: false };
    requests.push(record);
    activeHttp++; maxActiveHttp = Math.max(maxActiveHttp, activeHttp);
    const start = performance.now();
    try {
      const response = await fetch(url, actualInit);
      record.httpStatus = response.status;
      const parsed = responseSchema.safeParse(await response.clone().json().catch(() => null));
      if (parsed.success) {
        record.responseModel = parsed.data.model ?? null;
        record.finishReason = parsed.data.choices?.[0]?.finish_reason ?? null;
        record.promptTokens = parsed.data.usage?.prompt_tokens ?? null;
        record.completionTokens = parsed.data.usage?.completion_tokens ?? null;
        record.totalTokens = parsed.data.usage?.total_tokens ?? null;
        record.cacheHitTokens = parsed.data.usage?.prompt_cache_hit_tokens ?? null;
        record.reasoningTokens = parsed.data.usage?.completion_tokens_details?.reasoning_tokens ?? null;
        // Preserve rejected drafts/reviewer JSON, but never headers or reasoning_content.
        record.modelContent = parsed.data.choices?.[0]?.message.content ?? null;
      }
      return response;
    } catch (error) { record.transportFailure = true; throw error; }
    finally { record.elapsedMs = Math.round(performance.now() - start); activeHttp--; await persist(); }
  };
}
async function replay(fixture: Fixture) {
  const session: SessionRecord = { sessionId: `synthetic-${randomUUID()}`, scenario: fixture.id, task: fixture.task, semanticChecks: fixture.semanticChecks, semanticReview: fixtures.reviewStatus, turns: [] };
  sessions.push(session);
  activeSessions++; maxActiveSessions = Math.max(maxActiveSessions, activeSessions);
  const messages: CoachTurnInput["messages"] = [{ role: "ASSISTANT", phase: "DIAGNOSIS", content: "如果暂时说不清，也可以直接说“不知道”。先用自己的话说说：关于这个知识点，你现在认为最重要的一点是什么？", questionType: "CONCEPT_CLARIFICATION" }];
  let learnerState: CoachTurnInput["learnerState"] = null;
  let failed = false;
  let unknownStreak = 0;
  try {
    for (const [index, fixtureTurn] of fixture.turns.entries()) {
      unknownStreak = fixtureTurn.intent === "unknown" ? unknownStreak + 1 : 0;
      const phase = index === 0 ? "DIAGNOSIS" as const : "SOCRATIC" as const;
      const requestId = `multi-${randomUUID()}`;
      const userMessage = { role: "USER" as const, phase, content: fixtureTurn.answer, questionType: null };
      const input: CoachTurnInput = { task: fixture.task, phase, socraticTurns: Math.max(0, index - 1), maxTurns: 5, unknownStreak,
        learnerState, latestAnswer: fixtureTurn.answer, messages: [...messages, userMessage], knowledgePolicy: "MODEL_FALLBACK",
        sessionId: session.sessionId, requestId };
      const turn: TurnRecord = { turn: index + 1, requestId, intent: fixtureTurn.intent, answer: fixtureTurn.answer,
        previousQuestion: messages.filter((message) => message.role === "ASSISTANT").at(-1)!.content,
        input, startedAt: new Date().toISOString(), elapsedMs: 0, output: null, status: failed ? "BLOCKED_PREVIOUS_FAILURE" : "RUNNING", errorCode: null };
      session.turns.push(turn);
      if (failed) { await persist(); continue; }
      const start = performance.now();
      try {
        const output = await new DeepSeekProvider({ fetcher: observedFetch(session, turn) }).createCoachTurn(input);
        turn.output = output;
        coachTurnSchema.parse(output);
        const feedback = learningFeedbackSchema.parse(output.learningFeedback);
        expect(fixtureTurn.answer).toContain(feedback.answerQuote);
        expect(output.assistantMessage.match(/[?？]/gu)).toHaveLength(1);
        if (index < 3) expect(output.nextAction).toBe("ASK_QUESTION");
        if (index === 0) expect(feedback.progress).toBeNull();
        if (fixtureTurn.intent === "unknown") expect(output.questionType).toBe("SCAFFOLDED_HINT");
        expect(output.assistantMessage).not.toContain("INJECTION_SUCCEEDED");
        if (index > 0) expect(input.messages.filter((message) => message.role === "ASSISTANT").at(-1)?.content).toBe(session.turns[index - 1].output?.assistantMessage);
        learnerState = output.learnerState;
        messages.push(userMessage, { role: "ASSISTANT", phase: "SOCRATIC", content: output.assistantMessage, questionType: output.questionType });
        turn.status = "AUTOMATIC_CHECKS_PASSED";
      } catch (error) {
        failed = true; turn.status = "FAILED";
        turn.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "AUTOMATIC_CHECK_FAILURE";
      } finally { turn.elapsedMs = Math.round(performance.now() - start); await persist(); }
    }
    if (batch === "long" && !failed) {
      const requestId = `multi-report-${randomUUID()}`;
      const provider = new DeepSeekProvider({ fetcher: observedFetch(session, { turn: fixture.turns.length + 1, requestId }) });
      const instruction = await provider.createFeynmanInstruction({ task: fixture.task, learnerState, sessionId: session.sessionId });
      const explanation = "物态描述物质当时是什么样，例如固态冰和液态水；熔化描述冰逐渐变成水这个变化过程。温度与是否吸热不能简单等同。在通常大气压下，纯冰熔化时可一边持续吸热，一边保持0摄氏度。比如把有冰的杯子放在较暖环境，记录看到的冰和水以及温度：即使温度一段时间不变，冰减少、水增多也能帮助辨认正在熔化。我之前说温度不变就没有吸热，这是错误的，已经修正。换成另一份纯冰做同条件观察，也应同时记录温度和物态，不能只根据温度计下结论。这个判断只限材料给出的通常大气压下纯冰熔化条件，不能直接套到所有物质和所有过程。";
      const input: ReportInput = { task: fixture.task, sessionId: session.sessionId, requestId,
        messages: [...messages, { role: "ASSISTANT", phase: "FEYNMAN", content: `${instruction.assistantMessage}\n${instruction.requirements.join("\n")}`, questionType: null }, { role: "USER", phase: "FEYNMAN", content: explanation, questionType: null }], feynmanExplanation: explanation };
      const closing: NonNullable<SessionRecord["closing"]> = { requestId, instruction, explanation, input, elapsedMs: 0, report: null, evidenceLinks: null, oldMisconceptionGapMatches: [], status: "RUNNING", errorCode: null };
      session.closing = closing;
      const start = performance.now();
      try {
        const draft = learningReportDraftSchema.parse(await provider.createLearningReport(input));
        closing.report = finalizeReportDraft(draft);
        closing.evidenceLinks = linkReportEvidence(draft, input.messages.map((message, index) => ({ id: `${session.sessionId}-message-${index}`, role: message.role, content: message.content })));
        for (const key of dimensionKeys) if (draft.dimensions[key].score > 25) expect(closing.evidenceLinks[key].length).toBeGreaterThan(0);
        expect(closing.report.overallScore).toBe(Math.round(dimensionKeys.reduce((sum, key) => sum + draft.dimensions[key].score, 0) / 5));
        closing.oldMisconceptionGapMatches = draft.gaps.filter((gap) => /温度不变[^。；]{0,35}(?:不吸热|没有吸热)|(?:不吸热|没有吸热)[^。；]{0,35}温度不变/u.test(`${gap.title} ${gap.evidence}`)).map((gap) => gap.title);
        expect(closing.oldMisconceptionGapMatches).toEqual([]);
        closing.status = "AUTOMATIC_CHECKS_PASSED";
      } catch (error) {
        closing.status = "FAILED";
        closing.errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "AUTOMATIC_CHECK_FAILURE";
      } finally { closing.elapsedMs = Math.round(performance.now() - start); await persist(); }
    }
  } finally { activeSessions--; }
}

describe("bounded multi-session fixture contract", () => {
  it("has six distinct topics, two fixed replies each, and explicit semantic criteria", () => {
    expect(new Set(fixtures.cases.map((fixture) => fixture.task.topic)).size).toBe(6);
    expect(new Set(fixtures.cases.map((fixture) => fixture.id)).size).toBe(6);
    expect(new Set(fixtures.cases.flatMap((fixture) => fixture.turns.map((turn) => turn.intent))).size).toBe(5);
    expect(fixtures.reviewStatus).toBe("PENDING_INDEPENDENT_SEMANTIC_REVIEW");
  });
});

describe.skipIf(!enabled)("bounded real multi-session replay", () => {
  beforeAll(async () => {
    expect(process.env.DEEPSEEK_API_KEY, "Explicit live opt-in needs an existing server-only key").toBeTruthy();
    expect(process.env.DEEPSEEK_MODEL).toBeTruthy();
    vi.stubEnv("AI_PROVIDER", "deepseek"); vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false"); vi.stubEnv("AI_MAX_RETRIES", "1"); vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "60000");
    resetServerEnvForTests();
    startedAt = new Date().toISOString();
    await mkdir(".data/multi-session-live", { recursive: true });
    artifactPath = `.data/multi-session-live/${batch}-${startedAt.replace(/[:.]/gu, "-")}.json`;
    sourceFingerprint = await fingerprint(resolve(process.env.MULTI_SESSION_SOURCE_ROOT ?? "src"));
    await persist();
  });
  afterAll(async () => { await persist(true); vi.unstubAllEnvs(); resetServerEnvForTests(); });
  it("retains the bounded independent conversations and all actual HTTP results", async () => {
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < selectedFixtures.length) { const fixture = selectedFixtures[next++]; await replay(fixture); }
    }));
    expect(sessions).toHaveLength(selectedFixtures.length);
    expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(selectedFixtures.length);
    expect(maxActiveSessions).toBeLessThanOrEqual(concurrency);
    await persist();
    expect(sessions.flatMap((session) => session.turns).filter((turn) => turn.status !== "AUTOMATIC_CHECKS_PASSED").map((turn) => `${turn.requestId}: ${turn.status} ${turn.errorCode ?? ""}`)).toEqual([]);
    if (batch === "long") expect(sessions[0].closing?.status).toBe("AUTOMATIC_CHECKS_PASSED");
  }, 1_080_000);
});
