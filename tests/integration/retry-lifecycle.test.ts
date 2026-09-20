import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/errors";
import type { RetryReviewInput } from "@/lib/retry-review";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { createVersionSnapshot } from "@/lib/knowledge/releases";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { reviewCompletedRetry } from "@/lib/retry-lifecycle";
import * as requestLimits from "@/lib/request-limits";
import { createRetrySession, getReportPayload, submitFeynmanExplanation, submitLearningAnswer } from "@/lib/session-service";
import { createTestUser } from "../factories";

const explanation = "局部冲击通过共同资产和资金联系传播。例如机构因流动性压力抛售共同持仓，价格下跌引起更多损失。如果机构没有共同敞口，传导条件就不成立，需要重新检查资金与信心渠道。";
const answer = "机构之间共同持有资产，因此价格下跌会传染损失。如果流动性不足引发抛售，损失会进一步扩大，例如其他机构需要追加保证金。";

async function prepareRetry(curated = false) {
  const user = await createTestUser("retry-review");
  const parent = await prisma.learningSession.create({ data: {
    userId: user.id, topic: curated ? "系统性风险" : "金融传染机制", objective: "解释共同敞口与损失传播", learnerLevel: "有基础", phase: "COMPLETED",
    report: { create: { summary: "需要验证传导条件", overallScore: 50, overallLevel: "发展中", disclaimer: "形成性反馈",
      dimensions: { create: (["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"] as const).map((key) => ({ key, score: 50, evidence: "原表达未展示条件变化", feedback: "补充独立分析" })) },
      gaps: { create: { title: "传导的成立条件", evidence: "原解释未比较条件变化", repairTask: "用新例子解释共同敞口，并分析条件不成立时的结果。", priority: 5 } } } },
  }, include: { report: { include: { gaps: true } } } });
  const gap = parent.report!.gaps[0];
  const retry = await createRetrySession(parent.id, { clientRequestId: crypto.randomUUID() });
  return { user, parent, gap, id: retry.session.id };
}

async function reachFeynman(id: string) {
  for (let i = 0; i < 6; i++) {
    const payload = await submitLearningAnswer(id, { answer: `${answer}本轮编号${i}。`, clientRequestId: crypto.randomUUID() });
    if (payload.session.phase === "FEYNMAN") return;
  }
  throw new Error("Retry did not reach Feynman");
}

function resolved(input: RetryReviewInput) {
  const prior = input.messages.find((message) => message.phase === "SOCRATIC")!;
  const final = input.messages.find((message) => message.isIndependentExplanation)!;
  return { verdict: "RESOLVED" as const, confidence: 0.9, rationale: "本次两次独立作答明确解释了共同敞口，并比较了条件不成立时的情况。", evidence: [
    { messageId: prior.id, quote: prior.content.slice(0, 50) },
    { messageId: final.id, quote: final.content.slice(0, 70) },
  ] };
}

describe("source gap review and completed retry lifecycle", () => {
  beforeEach(() => { vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("persists a grounded resolution with the report, exposes it in browser DTOs, and keeps duplicates idempotent", async () => {
    const { parent, gap, id } = await prepareRetry();
    await reachFeynman(id);
    const review = vi.spyOn(MockAIProvider.prototype, "assessGapRepair").mockImplementation(async (input) => resolved(input));
    const clientRequestId = crypto.randomUUID();
    const completed = await submitFeynmanExplanation(id, { explanation, clientRequestId });
    expect(completed.payload.session.phase).toBe("COMPLETED");
    expect(completed.report!.retryReview).toMatchObject({ sourceGapId: gap.id, status: "RESOLVED", verdict: "RESOLVED" });
    const stored = await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } });
    expect(stored.status).toBe("RESOLVED");
    expect(stored.resolvedAt).toEqual(new Date(completed.report!.retryReview!.reviewedAt));
    const original = await getReportPayload(parent.id);
    expect(original.report.gaps[0]).toMatchObject({ status: "RESOLVED", latestRetry: { sessionId: id, phase: "COMPLETED" } });
    expect((await getReportPayload(id)).report.retryReview).toEqual(completed.report!.retryReview);
    const duplicate = await submitFeynmanExplanation(id, { explanation, clientRequestId });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.report).toEqual(completed.report);
    expect(review).toHaveBeenCalledTimes(1);
    expect(await prisma.learningReport.count({ where: { sessionId: id } })).toBe(1);
  });

  it("reopens insufficient evidence for another attempt without recording mastery", async () => {
    const { parent, gap, id } = await prepareRetry();
    await reachFeynman(id);
    const completed = await submitFeynmanExplanation(id, { explanation, clientRequestId: crypto.randomUUID() });
    expect(completed.report!.retryReview).toMatchObject({ verdict: "INSUFFICIENT_EVIDENCE", status: "OPEN" });
    expect(await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).toMatchObject({ status: "OPEN", resolvedAt: null });
    const next = await createRetrySession(parent.id, { clientRequestId: crypto.randomUUID() });
    expect(next.session.id).not.toBe(id);
    expect(next.session.parentSessionId).toBe(parent.id);
    expect(await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).toMatchObject({ status: "IN_PROGRESS", resolvedAt: null });
    expect((await getReportPayload(parent.id)).report.gaps[0].latestRetry?.sessionId).toBe(next.session.id);
  });

  it.each(["timeout", "fabricated quote"])("does not commit a report, answer, or state after a review %s", async (failure) => {
    const { gap, id } = await prepareRetry();
    await reachFeynman(id);
    const before = await prisma.learningSession.findUniqueOrThrow({ where: { id }, include: { messages: true } });
    const spy = vi.spyOn(MockAIProvider.prototype, "assessGapRepair");
    if (failure === "timeout") spy.mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "timed out", 503, true));
    else spy.mockImplementationOnce(async (input) => ({ ...resolved(input), evidence: [{ messageId: input.messages[0].id, quote: "这段内容并未在学生原文中实际出现，不能作为修复依据。" }] }));
    const clientRequestId = crypto.randomUUID();
    await expect(submitFeynmanExplanation(id, { explanation, clientRequestId })).rejects.toMatchObject({ code: failure === "timeout" ? "AI_TIMEOUT" : "AI_INVALID_OUTPUT" });
    const after = await prisma.learningSession.findUniqueOrThrow({ where: { id }, include: { messages: true } });
    expect(after.phase).toBe("FEYNMAN");
    expect(after.version).toBe(before.version);
    expect(after.messages.length).toBe(before.messages.length);
    expect(await prisma.learningReport.count({ where: { sessionId: id } })).toBe(0);
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe("IN_PROGRESS");
    spy.mockImplementation(async (input) => resolved(input));
    expect((await submitFeynmanExplanation(id, { explanation, clientRequestId })).report!.retryReview!.status).toBe("RESOLVED");
  });

  it("rejects a source gap from another student before reviewing or changing either report", async () => {
    const own = await prepareRetry();
    const other = await prepareRetry();
    await reachFeynman(own.id);
    await prisma.learningSession.update({ where: { id: own.id }, data: { sourceGapId: other.gap.id, parentSessionId: other.parent.id } });
    const spy = vi.spyOn(MockAIProvider.prototype, "assessGapRepair");
    await expect(submitFeynmanExplanation(own.id, { explanation, clientRequestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.learningReport.count({ where: { sessionId: own.id } })).toBe(0);
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: other.gap.id } })).status).toBe("IN_PROGRESS");
  });

  it("also reviews and reopens the source gap after a complete v1.2 explanation and reflection", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    const { gap, id } = await prepareRetry(true);
    let payload = await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: crypto.randomUUID() });
    for (let i = 0; i < 25 && payload.session.phase !== "FEYNMAN"; i++) {
      payload = await submitLearningAnswer(id, { answer: `共同资产价格下跌可能增加融资压力，造成进一步的抛售和信贷收缩。这是第${i}次独立分析。`, clientRequestId: crypto.randomUUID() });
    }
    expect(payload.session.knowledgeProgress?.pedagogicalStage).toBe("FEYNMAN_OUTPUT");
    const spy = vi.spyOn(MockAIProvider.prototype, "assessGapRepair");
    const explained = await submitFeynmanExplanation(id, { explanation, clientRequestId: crypto.randomUUID() });
    expect(explained.report).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    const completed = await submitFeynmanExplanation(id, { explanation: "我补充反思：共同敞口只是传播条件之一，还要检查流动性压力、资产价格变化与信贷收缩的因果关系。", clientRequestId: crypto.randomUUID() });
    expect(completed.payload.session.phase).toBe("COMPLETED");
    expect(completed.report!.retryReview).toMatchObject({ sourceGapId: gap.id, status: "OPEN" });
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe("OPEN");
    const reviewInput = spy.mock.calls[0][0];
    expect(reviewInput.messages.filter((message) => message.isIndependentExplanation)).toEqual([
      expect.objectContaining({ id: completed.report!.evidenceAudit!.finalFeynmanMessageId, content: explanation }),
    ]);
    expect(reviewInput.messages.at(-1)!.isIndependentExplanation).toBe(false);
  });

  it("only commits one review when two completions race", async () => {
    const { gap, id } = await prepareRetry();
    await reachFeynman(id);
    vi.spyOn(MockAIProvider.prototype, "assessGapRepair").mockImplementation(async (input) => resolved(input));
    const attempts = await Promise.allSettled([1, 2].map(() => submitFeynmanExplanation(id, { explanation, clientRequestId: crypto.randomUUID() })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.learningReport.count({ where: { sessionId: id } })).toBe(1);
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe("RESOLVED");
  });

  it("returns the committed report when a replay reaches gap review after the first completion", async () => {
    const { id } = await prepareRetry();
    await reachFeynman(id);
    // Model an expired/distributed AI lease: database idempotency must still
    // protect a replay even when the in-memory lock no longer serializes it.
    vi.spyOn(requestLimits, "withAIRequestProtection").mockImplementation(async (_user, _key, operation) => operation());
    const original = MockAIProvider.prototype.createLearningReport;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const bothEntered = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const winnerCommitted = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let calls = 0;
    vi.spyOn(MockAIProvider.prototype, "createLearningReport").mockImplementation(async function (input) {
      if (++calls === 1) await bothEntered;
      else { releaseFirst(); await winnerCommitted; }
      return original.call(new MockAIProvider(), input);
    });
    const review = vi.spyOn(MockAIProvider.prototype, "assessGapRepair").mockImplementation(async (input) => resolved(input));
    const clientRequestId = crypto.randomUUID();
    const attempts = [1, 2].map(() => submitFeynmanExplanation(id, { explanation, clientRequestId }));
    const winner = await Promise.race(attempts);
    releaseSecond();
    const results = await Promise.all(attempts);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0].report).toEqual(winner.report);
    expect(results[1].report).toEqual(winner.report);
    expect(review).toHaveBeenCalledTimes(1);
    expect(await prisma.message.count({ where: { clientRequestId } })).toBe(1);
  });

  it("does not resolve a structured gap whose claim is resolved but prerequisite-dependent unit is still partial", async () => {
    const { gap, id } = await prepareRetry();
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    const manifest = buildV12Manifest();
    const runtime = initialKnowledgeRuntime(createVersionSnapshot(manifest));
    const [claimId, definition] = Object.entries(manifest.v12!.errors)[0];
    runtime.v12!.unitStates[definition.targetId] = { status: "PARTIAL", evidenceRefs: [], independentEvidenceCount: 1, verificationCount: 1, questionIds: [], lastUpdatedAt: new Date().toISOString() };
    runtime.v12!.finalClaims = [{ id: claimId, type: "MISCONCEPTION", status: "RESOLVED", evidenceRefs: [], confidence: 0.95 }];
    await prisma.learningGap.update({ where: { id: gap.id }, data: { evidence: `原错误证据（${claimId}）` } });
    const spy = vi.spyOn(MockAIProvider.prototype, "assessGapRepair").mockImplementation(async (input) => resolved(input));
    const session = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const review = await reviewCompletedRetry(session, { report: { summary: "本次已分析原要点", gaps: [] }, messages: [
      { id: "socratic-evidence", role: "USER", phase: "SOCRATIC", content: answer },
      { id: "feynman-evidence", role: "USER", phase: "FEYNMAN", content: explanation, isIndependentExplanation: true },
    ] }, crypto.randomUUID(), runtime);
    expect(spy.mock.calls[0][0].resolutionBlockedReason).toContain("结构化核验");
    expect(review).toMatchObject({ verdict: "INSUFFICIENT_EVIDENCE", status: "OPEN" });
  });

  it("reviews a long supported retry within the provider budget without losing independent evidence or claiming mastery from partial history", async () => {
    vi.stubEnv("MAX_MESSAGES_PER_SESSION", "120");
    const { id } = await prepareRetry();
    const session = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const messages: RetryReviewInput["messages"] = [
      { id: "early-independent", role: "USER", phase: "FEYNMAN", content: explanation, isIndependentExplanation: true },
      ...Array.from({ length: 44 }, (_, index) => ({ id: `later-verification-${index}`, role: "USER" as const, phase: "SOCRATIC" as const, content: `${answer}第${index}次核验。` })),
    ];
    const spy = vi.spyOn(MockAIProvider.prototype, "assessGapRepair").mockImplementation(async (input) => resolved(input));
    const review = await reviewCompletedRetry(session, { report: { summary: "本次经历多次补充核验", gaps: [] }, messages }, crypto.randomUUID());
    const sent = spy.mock.calls[0][0];
    expect(sent.messages).toHaveLength(40);
    expect(sent.messages[0]).toEqual(messages[0]);
    expect(sent.messages.at(-1)).toEqual(messages.at(-1));
    expect(sent.resolutionBlockedReason).toContain("历史");
    expect(review).toMatchObject({ verdict: "INSUFFICIENT_EVIDENCE", status: "OPEN" });
  });

  it("migration reopens legacy completed retries but preserves active and resolved gaps", async () => {
    const old = await prepareRetry();
    const active = await prepareRetry();
    const alreadyResolved = await prepareRetry();
    await prisma.learningSession.update({ where: { id: old.id }, data: { phase: "COMPLETED", report: { create: { summary: "旧报告", overallScore: 60, overallLevel: "形成性反馈", disclaimer: "测试" } } } });
    await prisma.learningGap.update({ where: { id: alreadyResolved.gap.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    const migration = await readFile("prisma/migrations-postgresql/20260919060000_retry_gap_review/migration.sql", "utf8");
    const update = migration.slice(migration.indexOf('UPDATE "LearningGap"'));
    await prisma.$executeRawUnsafe(update);
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: old.gap.id } })).status).toBe("OPEN");
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: active.gap.id } })).status).toBe("IN_PROGRESS");
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: alreadyResolved.gap.id } })).status).toBe("RESOLVED");
  });
});
