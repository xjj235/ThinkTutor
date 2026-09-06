import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createTestUser } from "../factories";
import { createLearningSession, getSessionPayload } from "@/lib/session-service";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { criticalStepRule } from "@/lib/knowledge/v12-engine";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { POST as answerRoute } from "@/app/api/sessions/[id]/answers/route";
import { POST as eventRoute } from "@/app/api/sessions/[id]/events/route";
import type { AuthUser } from "@/lib/auth/session";

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => auth.user }));
const manifest = buildV12Manifest();
const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "系统性风险", objective: "以因果证据解释风险传导", learnerLevel: "有基础" };
const positive = Object.keys(manifest.v12!.evidenceDefinitions).filter((id) => ![...Object.values(manifest.v12!.unitRules), ...Object.values(manifest.v12!.relationRules)].some((r) => r.prohibited.includes(id)));
const json = (value: object) => structuredClone(value) as Prisma.InputJsonValue;
async function postAnswer(id: string) {
  return answerRoute(new Request(`http://localhost/api/sessions/${id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: `工程回归回答，验证当前问题的证据引用与事务边界。${crypto.randomUUID()}`, clientRequestId: crypto.randomUUID() }) }), { params: Promise.resolve({ id }) });
}
function mockEvidence(ids: string[], confidence = 0.9) {
  vi.spyOn(MockAIProvider.prototype, "assessLearningTurn").mockImplementation(async ({ message }) => ({ evidence: ids.map((evidenceId) => ({ evidenceId, messageId: message.id, extractedText: message.content })), candidateMastery: [], candidateMisconceptions: [], candidateGaps: [], contradictions: [], recommendTransition: true, modelAssessmentConfidence: confidence }));
}
describe("v1.2 API case and recovery matrix", () => {
  beforeEach(() => { vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it.each(manifest.cases.map((c) => c.id))("%s accepts complete evidence and repairs every missing critical step through the API", async (caseId) => {
    auth.user = await createTestUser(`case-${caseId}`);
    for (const step of [null, ...manifest.v12!.cases[caseId].criticalSteps]) {
      const created = await createLearningSession(auth.user.id, task);
      const id = created.session.id;
      await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: crypto.randomUUID() });
      const row = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
      const runtime = knowledgeRuntimeSchema.parse(row.knowledgeRuntime);
      runtime.v12!.pedagogicalStage = "CASE_TRANSFER"; runtime.v12!.activityType = "CASE_ANALYSIS";
      runtime.v12!.currentCaseId = caseId; runtime.v12!.currentCaseUnseen = true;
      runtime.currentTargetId = "COMP_SR_TRANSFER"; runtime.currentQuestionId = `CASE_QUESTION_${caseId}`;
      for (const target of Object.keys(manifest.v12!.unitRules)) runtime.v12!.unitStates[target] = { status: "MASTERED", evidenceRefs: [], independentEvidenceCount: 2, verificationCount: 1, questionIds: ["fixture-1", "fixture-2"], lastUpdatedAt: new Date().toISOString() };
      // Database fixture only; no production endpoint can select a case or award mastery.
      await prisma.learningSession.update({ where: { id }, data: { phase: "SOCRATIC", socraticTurns: 2, knowledgeRuntime: json(runtime) } });
      const missing = step ? criticalStepRule(manifest, step).requiredAll[0] : null;
      mockEvidence(positive.filter((id) => id !== missing));
      const response = await postAnswer(id);
      expect(response.status).toBe(200);
      const payload = (await response.json()).data;
      if (!step) expect(payload.session.knowledgeProgress.pedagogicalStage).toBe("FEYNMAN_OUTPUT");
      else expect(payload.session.knowledgeProgress.pedagogicalStage).toBe("KNOWLEDGE_CONSTRUCTION");
      const saved = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
      expect(saved.v12!.stageTransitions.at(-1)?.reasonCode).toBe(step ? "CASE_REPAIR_REQUIRED" : "CASE_PASSED");
      expect(saved.v12!.stageTransitions.at(-1)?.evidenceRefs.length).toBeGreaterThan(0);
      vi.restoreAllMocks();
    }
  });
  it("requires explicit goal confirmation, rejects tampering, and resumes with a short verification", async () => {
    auth.user = await createTestUser("goal-resume");
    const created = await createLearningSession(auth.user.id, task);
    const id = created.session.id;
    expect((await postAnswer(id)).status).toBe(409);
    const request = (body: object) => eventRoute(new Request(`http://localhost/api/sessions/${id}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    const goal = { action: "GOAL_CONFIRMED", clientRequestId: crypto.randomUUID() };
    expect((await request({ ...goal, phase: "COMPLETED" })).status).toBe(400);
    expect((await request(goal)).status).toBe(200);
    expect((await (await request(goal)).json()).data.duplicate).toBe(true);
    mockEvidence(positive);
    expect((await postAnswer(id)).status).toBe(200);
    await prisma.learningSession.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await getSessionPayload(id)).session.knowledgeProgress?.resumeRequired).toBe(true);
    expect((await postAnswer(id)).status).toBe(409);
    await submitV12SessionEvent(id, { action: "SESSION_RESUMED", clientRequestId: crypto.randomUUID() });
    const before = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    mockEvidence([], 0.3);
    expect((await postAnswer(id)).status).toBe(200);
    expect((await getSessionPayload(id)).session.knowledgeProgress?.resumeVerification).toBe(true);
    mockEvidence(positive);
    expect((await postAnswer(id)).status).toBe(200);
    const after = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    expect(after.phase).toBe(before.phase); expect(after.socraticTurns).toBe(before.socraticTurns);
    const state = knowledgeRuntimeSchema.parse(after.knowledgeRuntime).v12!;
    expect(state.resumeVerification).toBeNull();
    expect(state.stageTransitions.at(-1)?.reasonCode).toBe("RESUMED_REVERIFIED");
    expect(state.goalConfirmedAt).toBeTruthy();
  });
});
