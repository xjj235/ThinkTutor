import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { createLearningSession, getSessionPayload, requestHint as requestLearningHint, submitLearningAnswer } from "@/lib/session-service";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { AIProviderError } from "@/lib/errors";
import { createTestUser } from "../factories";

const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "系统性风险", objective: "解释系统性风险的判断条件。", learnerLevel: "有基础" };
const answer = "系统性风险关注金融体系，不是单家银行的损失。还需要核实金融功能受损的影响是否传播。";
describe("transactional knowledge-bounded teaching selection", () => {
  beforeEach(() => { vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("uses the provider for goals, diagnosis, hints and resume without repeating a saved request", async () => {
    const student = await createTestUser("coaching-kinds");
    const spy = vi.spyOn(MockAIProvider.prototype, "selectTeachingMove");
    const initial = await createLearningSession(student.id, task);
    const id = initial.session.id;
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `${id}-goal` });
    await submitLearningAnswer(id, { answer, clientRequestId: `${id}-answer` });
    await requestLearningHint(id, { clientRequestId: `${id}-hint` });
    const calls = spy.mock.calls.length;
    const duplicate = await requestLearningHint(id, { clientRequestId: `${id}-hint` });
    expect(duplicate.duplicate).toBe(true);
    expect(spy.mock.calls).toHaveLength(calls);
    await submitV12SessionEvent(id, { action: "SESSION_RESUMED", clientRequestId: `${id}-resume` });
    expect(spy.mock.calls.map(([input]) => input.kind)).toEqual(expect.arrayContaining(["GOAL", "DIAGNOSIS", "HINT", "RESUME"]));
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const runtime = knowledgeRuntimeSchema.parse(saved.knowledgeRuntime);
    expect(runtime.v12!.coachingHistory).toHaveLength(spy.mock.calls.length);
    expect(runtime.v12!.coachingHistory.every((entry) => entry.provider === "mock")).toBe(true);
    expect(runtime.v12!.coachingHistory.every((entry) => entry.decisionBasis?.policyVersion === "1.2")).toBe(true);
    expect(runtime.v12!.coachingPrompt?.text).not.toContain("原文依据");
  });

  it("does not create a session when the goal presentation provider fails", async () => {
    const student = await createTestUser("coaching-create-failure");
    vi.spyOn(MockAIProvider.prototype, "selectTeachingMove").mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "test timeout", 503, true));
    await expect(createLearningSession(student.id, task)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(await prisma.learningSession.count({ where: { userId: student.id } })).toBe(0);
  });

  it("persists supported-gap routing without promoting uncertain mastery and keeps retries idempotent", async () => {
    const student = await createTestUser("coaching-supported-gap");
    const initial = await createLearningSession(student.id, task);
    const id = initial.session.id;
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `${id}-goal` });
    const scopeAnswer = "系统性风险的研究对象是整个金融体系，不是单家银行的经营损失。目前我只说明了研究范围，还没有说明金融服务受到什么影响。";
    vi.spyOn(MockAIProvider.prototype, "assessLearningTurn").mockImplementationOnce(async (input) => ({
      evidence: [{ evidenceId: "financial_system_scope", messageId: input.message.id, extractedText: "系统性风险的研究对象是整个金融体系，不是单家银行的经营损失。" }],
      candidateMastery: [{ unitId: "C_SR_001", modelConfidence: 0.5 }], candidateGaps: [{ id: "GAP_DEFINITION_ONLY", modelConfidence: 0.9 }],
      candidateMisconceptions: [], modelAssessmentConfidence: 0.5, contradictions: [], recommendTransition: false,
    }));
    await submitLearningAnswer(id, { answer: scopeAnswer, clientRequestId: `${id}-gap` });
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const runtime = knowledgeRuntimeSchema.parse(saved.knowledgeRuntime);
    const trace = runtime.v12!.coachingHistory.at(-1)!;
    expect(trace.profile.dimension).toBe("MECHANISM");
    expect(trace.decisionBasis!.assessment).toMatchObject({ confidence: 0.5, minimumConfidence: 0.75, supportedGap: { confidence: 0.9 } });
    expect(runtime.v12!.lastResult).toBe("NEED_VERIFY");
    expect(runtime.flags).toContain("FLAG_NEED_VERIFY");
    expect(runtime.v12!.pedagogicalStage).toBe("DIAGNOSIS");
    expect(runtime.v12!.unitStates.C_SR_001.independentEvidenceCount).toBe(0);
    expect(saved.messages.at(-1)!.content).toContain("尚不足以确认整体掌握");
    expect(saved.messages.at(-1)!.content).toContain(trace.followUp!.question);
    const duplicate = await submitLearningAnswer(id, { answer: scopeAnswer, clientRequestId: `${id}-gap` });
    expect(duplicate.duplicate).toBe(true);
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).toEqual(saved.knowledgeRuntime);
  });

  it("rolls back evidence and phase changes when model selection is invalid", async () => {
    const student = await createTestUser("coaching-invalid");
    const initial = await createLearningSession(student.id, task);
    const id = initial.session.id;
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `${id}-goal` });
    const before = await getSessionPayload(id);
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    vi.spyOn(MockAIProvider.prototype, "selectTeachingMove").mockResolvedValueOnce({ choiceId: "invented", openingId: "OPEN_DIRECT" });
    await expect(submitLearningAnswer(id, { answer, clientRequestId: `${id}-invalid` })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(await getSessionPayload(id)).toEqual(before);
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).toEqual(saved.knowledgeRuntime);
  });

  it("does not consume a hint level or confirm a goal when the real-provider contract fails", async () => {
    const student = await createTestUser("coaching-event-failure");
    const initial = await createLearningSession(student.id, task);
    const id = initial.session.id;
    const fail = vi.spyOn(MockAIProvider.prototype, "selectTeachingMove");
    fail.mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "test timeout", 503, true));
    await expect(submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `${id}-failed-goal` })).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect((await getSessionPayload(id)).session.knowledgeProgress?.pedagogicalStage).toBe("GOAL_PRESENTATION");
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `${id}-goal` });
    const before = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    fail.mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "test timeout", 503, true));
    await expect(requestLearningHint(id, { clientRequestId: `${id}-failed-hint` })).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).toEqual(before.knowledgeRuntime);
  });

  it("saves answer-grounded followups through the HTML service and rolls back a missing generated question", async () => {
    const student = await createTestUser("coaching-generated");
    const initial = await createLearningSession(student.id, task);
    const id = initial.session.id;
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `${id}-goal` });
    const spy = vi.spyOn(MockAIProvider.prototype, "selectTeachingMove");
    await submitLearningAnswer(id, { answer, clientRequestId: `${id}-first` });
    const call = spy.mock.calls.at(-1)![0];
    expect(call.grounding).toBeDefined();
    expect(call.studentContent).toBe(answer);
    expect(call.recentTurns?.some((t) => t.role === "ASSISTANT")).toBe(true);
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const runtime = knowledgeRuntimeSchema.parse(saved.knowledgeRuntime);
    const generated = runtime.v12!.coachingHistory.at(-1)?.followUp;
    expect(generated).toBeDefined();
    expect(runtime.v12!.coachingPrompt?.text).toBe(generated!.question);
    expect(saved.messages.at(-1)?.content).toContain(generated!.question);
    const basis = runtime.v12!.coachingHistory.at(-1)!.decisionBasis!;
    const studentMessage = saved.messages.find((message) => message.id === basis.basisMessageId)!;
    expect(studentMessage.role).toBe("USER");
    expect(basis.contentHash).toBe(runtime.versions.contentHash);
    expect(basis.assessedTargetId).toBe("C_SR_001");
    expect(basis.selectedRuleId).toBe("COACH_FILL_GAP");
    expect(basis.matchedRuleIds).toContain("VERIFY_SYSTEMIC_CONDITION");
    expect(basis.questionRequirements).toEqual(runtime.v12!.coachingPrompt!.rule);
    expect(basis.evidence.length).toBeGreaterThan(0);
    for (const ref of basis.evidence) {
      expect(ref.messageId).toBe(studentMessage.id);
      expect(studentMessage.content.slice(ref.startOffset, ref.endOffset)).toBe(ref.extractedText);
    }
    const duplicate = await submitLearningAnswer(id, { answer, clientRequestId: `${id}-first` });
    expect(duplicate.duplicate).toBe(true);
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).toEqual(saved.knowledgeRuntime);
    const before = await getSessionPayload(id);
    spy.mockImplementationOnce(async (input) => ({ choiceId: input.choices[0].id, openingId: input.openings[0].id }));
    await expect(submitLearningAnswer(id, { answer: "我暂时还不能说明条件变化后会如何修正，只有金融体系功能这个判断范围。", clientRequestId: `${id}-missing-question` })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(await getSessionPayload(id)).toEqual(before);
  });
});
