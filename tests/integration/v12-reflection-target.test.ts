import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { prisma } from "@/lib/db";
import { createLearningSession, submitFeynmanExplanation } from "@/lib/session-service";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { createTestUser } from "../factories";

const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "系统性风险", objective: "解释风险传播与条件", learnerLevel: "有基础" };
const initialAnswer = "我目前认为只有直接债权债务联系才会传播系统性风险，其他机构缺少这种联系就不会同时受损。";
const revision = "我修正了只沿直接借贷传播的看法：即使两家机构没有直接借贷，也可能因为共同持有同类资产，在同一价格下跌时同时遭受损失。";

describe("reflection assessment target binding", () => {
  beforeEach(() => { vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([false, true])("assesses only the selected reflection target and preserves an unrelated transfer gap (legacy mismatch: %s)", async (legacyMismatch) => {
    const user = await createTestUser(`reflection-target-${legacyMismatch}`);
    const created = await createLearningSession(user.id, task);
    const id = created.session.id;
    const runtime = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
    // Start at independent explanation. The two answers below deliberately do
    // not cover the integrated transfer rubric, so an incorrect target cannot
    // hide behind an answer that happens to satisfy every knowledge unit.
    runtime.currentTargetId = "COMP_SR_TRANSFER";
    runtime.currentQuestionId = null;
    runtime.pedagogicalStage = "FEYNMAN";
    runtime.v12!.pedagogicalStage = "FEYNMAN_OUTPUT";
    runtime.v12!.activityType = "INDEPENDENT_EXPLANATION";
    runtime.v12!.coachingPrompt = null;
    await prisma.learningSession.update({ where: { id }, data: { phase: "FEYNMAN", knowledgeRuntime: runtime as Prisma.InputJsonValue } });
    const assess = vi.spyOn(MockAIProvider.prototype, "assessLearningTurn")
      .mockImplementationOnce(async (input) => ({
        evidence: [{ evidenceId: "direct_link_only", messageId: input.message.id, extractedText: initialAnswer }],
        candidateMisconceptions: [{ id: "ERR_E03_DIRECT_LINK_ONLY", modelConfidence: 0.9 }], candidateGaps: [], candidateMastery: [],
        modelAssessmentConfidence: 0.9, contradictions: [], recommendTransition: false,
      }))
      .mockImplementationOnce(async (input) => ({
        evidence: ["no_direct_link_required", "shared_asset_exposure", "common_shock_can_harm_both"].map((evidenceId) => ({ evidenceId, messageId: input.message.id, extractedText: revision })),
        candidateMisconceptions: [], candidateGaps: [], candidateMastery: [{ unitId: "M_SR_002", modelConfidence: 0.9 }],
        modelAssessmentConfidence: 0.9, contradictions: [], recommendTransition: false,
      }));

    const reflection = await submitFeynmanExplanation(id, { explanation: initialAnswer, clientRequestId: `${id}-explain` });
    expect(reflection.payload.session.phase).toBe("FEYNMAN");
    expect(reflection.payload.session.knowledgeProgress?.pedagogicalStage).toBe("REFLECTION");
    expect(reflection.payload.messages.at(-1)!.content).toContain("围绕共同暴露");
    const reflecting = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
    expect(reflecting.v12!.reflectionTargetId).toBe("M_SR_002");
    expect(reflecting.currentTargetId).toBe("M_SR_002");
    expect(reflecting.v12!.coachingHistory.at(-1)!.decisionBasis).toMatchObject({ assessedTargetId: "COMP_SR_TRANSFER", selectedTargetId: "M_SR_002" });
    expect(reflecting.v12!.gapStates.GAP_TRANSFER.status).toBe("CONFIRMED");
    const priorTransferState = structuredClone(reflecting.v12!.unitStates.COMP_SR_TRANSFER);
    const priorTransferAttempts = reflecting.targetAttempts.COMP_SR_TRANSFER;
    if (legacyMismatch) {
      reflecting.currentTargetId = "COMP_SR_TRANSFER";
      const trace = reflecting.v12!.coachingHistory.at(-1)!;
      trace.profile.targetId = "COMP_SR_TRANSFER";
      trace.decisionBasis!.selectedTargetId = "COMP_SR_TRANSFER";
      await prisma.learningSession.update({ where: { id }, data: { knowledgeRuntime: reflecting as Prisma.InputJsonValue } });
    }

    const result = await submitFeynmanExplanation(id, { explanation: revision, clientRequestId: `${id}-revise` });
    const input = assess.mock.calls[1][0];
    expect(input.lockedContext).toMatchObject({ stage: "REFLECTION", targetId: "M_SR_002", questionId: null, caseId: null });
    expect(input.lockedContext.questionText).toContain("围绕共同暴露");
    expect(input.knowledgeUnits.map((unit) => unit.id)).toContain("M_SR_002");
    expect(input.evaluationRules!.CURRENT_QUESTION).toEqual(buildV12Manifest().v12!.unitRules.M_SR_002);
    expect(input.evaluationRules!.M_SR_002).toEqual(input.evaluationRules!.CURRENT_QUESTION);
    expect(input.evaluationRules!.COMP_SR_TRANSFER).toBeUndefined();

    const saved = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
    expect(result.payload.session.phase).toBe("COMPLETED");
    expect(saved.v12!.lastAssessmentContext).toMatchObject({ targetId: "M_SR_002", stage: "REFLECTION" });
    expect(saved.v12!.coachingHistory.at(-1)!.decisionBasis!.assessedTargetId).toBe("M_SR_002");
    expect(saved.v12!.misconceptionStates.ERR_E03_DIRECT_LINK_ONLY.status).toBe("RESOLVED");
    expect(saved.v12!.gapStates.GAP_COMMON_EXPOSURE.status).toBe("RESOLVED");
    expect(saved.v12!.unitStates.COMP_SR_TRANSFER).toEqual(priorTransferState);
    expect(saved.targetAttempts.COMP_SR_TRANSFER).toBe(priorTransferAttempts);
    expect(saved.v12!.gapStates.GAP_TRANSFER.status).not.toBe("RESOLVED");
    expect(saved.v12!.finalClaims.find((claim) => claim.id === "GAP_TRANSFER")?.status).toBe("UNRESOLVED");
    expect(result.payload.messages.at(-1)!.learningFeedback!.answerQuote).toBe(revision);
    expect(result.payload.messages.at(-1)!.learningFeedback!.progress).toBeNull();
    expect(result.payload.messages.at(-1)!.feedbackForMessageId).toBe(result.payload.messages.at(-2)!.id);
  });
});
