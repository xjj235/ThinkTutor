import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { POST as feynmanRoute } from "@/app/api/sessions/[id]/feynman/route";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AuthUser } from "@/lib/auth/session";
import type { ApiSuccess, LearningReportDTO, SessionPayload } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/errors";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { constructionReady } from "@/lib/knowledge/v12-engine";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { createLearningSession, getSessionPayload, submitFeynmanExplanation, submitLearningAnswer } from "@/lib/session-service";
import { createTestUser } from "../factories";

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => auth.user }));

const partialAnswer = "共同资产价格下跌可能增加融资压力，造成进一步的抛售和信贷收缩。";
const explanation = "我向初学者解释：金融体系中，共同资产的价格下跌会传播风险。例如银行同时抛售资产，价格进一步下降并引起信贷收缩。";
const revision = "我修订刚才的讲解：例如共同持仓受到冲击后，集中抛售让风险传播，金融体系的信贷收缩还可能影响投资与就业。";

async function reachExperienceLimit(maxTurns = 5) {
  const user = await createTestUser("spec-feynman-limit");
  auth.user = user;
  const created = await createLearningSession(user.id, {
    course: undefined, chapter: undefined, referenceText: undefined,
    topic: "系统性风险", objective: "解释金融风险的传播机制和适用条件", learnerLevel: "入门",
  });
  const id = created.session.id;
  await prisma.learningSession.update({ where: { id }, data: { maxTurns } });
  let payload = await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `goal-${id}` });
  for (let index = 0; index < 25 && payload.session.phase !== "FEYNMAN"; index += 1) {
    payload = await submitLearningAnswer(id, { answer: `${partialAnswer}这是第${index}次独立分析。`, clientRequestId: `answer-${id}-${index}` });
  }
  expect(payload.session.phase).toBe("FEYNMAN");
  expect(payload.session.socraticTurns).toBe(maxTurns);
  return { id, payload };
}

describe("required independent explanation after the v1.2 turn budget", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); auth.user = null; });

  it.each([3, 4, 5])("persists a separate explanation and revision at a %i-turn budget without awarding unproven mastery", async (maxTurns) => {
    const { id, payload } = await reachExperienceLimit(maxTurns);
    expect(payload.session.knowledgeProgress).toMatchObject({ pedagogicalStage: "FEYNMAN_OUTPUT", experienceLimitReached: true });
    expect(payload.report).toBeNull();
    const before = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
    expect(constructionReady(before.v12!)).toBe(false);
    expect(before.v12!.transferPassed).toBe(false);
    expect(before.v12!.finalFeynmanMessageId).toBeNull();
    expect(before.v12!.stageTransitions.at(-1)).toMatchObject({ toStage: "FEYNMAN_OUTPUT", reasonCode: "EXPERIENCE_LIMIT" });

    const clientRequestId = `explanation-${id}`;
    const response = await feynmanRoute(new Request(`http://localhost/api/sessions/${id}/feynman`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ explanation, clientRequestId }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const result = await response.json() as ApiSuccess<{ payload: SessionPayload; report: LearningReportDTO | null }>;
    expect(result.data.report).toBeNull();
    expect(result.data.payload.session.knowledgeProgress).toMatchObject({ pedagogicalStage: "REFLECTION", experienceLimitReached: true });
    expect(await prisma.learningReport.count({ where: { sessionId: id } })).toBe(0);
    const explained = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
    expect(explained.v12!.finalFeynmanMessageId).toBe(result.data.payload.messages.find((message) => message.clientRequestId === clientRequestId)?.id);
    expect(explained.v12!.finalRevisionMessageId).toBeNull();
    const duplicate = await submitFeynmanExplanation(id, { explanation, clientRequestId });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.payload.session.knowledgeProgress?.pedagogicalStage).toBe("REFLECTION");
    expect(duplicate.report).toBeNull();

    const final = await submitFeynmanExplanation(id, { explanation: revision, clientRequestId: `revision-${id}` });
    expect(final.payload.session).toMatchObject({ phase: "COMPLETED", socraticTurns: maxTurns });
    expect(final.report?.evidenceAudit).toMatchObject({ pedagogicalStage: "REPORT", experienceLimitReached: true, transferPassed: false });
    expect(final.report!.evidenceAudit!.finalFeynmanMessageId).not.toBe(final.report!.evidenceAudit!.finalRevisionMessageId);
    expect(final.report!.evidenceAudit!.finalRevisionMessageId).toBe(final.payload.messages.find((message) => message.clientRequestId === `revision-${id}`)?.id);
    expect(final.report!.dimensions.transferAbility.score).toBeLessThanOrEqual(50);
    expect(final.report!.gaps.length).toBeGreaterThan(0);
    expect(constructionReady(final.report!.evidenceAudit!)).toBe(false);
    expect((await getSessionPayload(id)).report).toEqual(final.report);
    expect(await prisma.learningReport.count({ where: { sessionId: id } })).toBe(1);
  });

  it("keeps the explanation and turn count intact when assessment fails", async () => {
    const { id } = await reachExperienceLimit();
    const before = await prisma.learningSession.findUniqueOrThrow({ where: { id }, include: { messages: true } });
    vi.spyOn(MockAIProvider.prototype, "assessLearningTurn").mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "timeout", 503, true));
    await expect(submitFeynmanExplanation(id, { explanation, clientRequestId: `failed-${id}` })).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    const after = await prisma.learningSession.findUniqueOrThrow({ where: { id }, include: { messages: true } });
    expect(after.version).toBe(before.version);
    expect(after.socraticTurns).toBe(before.socraticTurns);
    expect(after.knowledgeRuntime).toEqual(before.knowledgeRuntime);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(await prisma.learningReport.count({ where: { sessionId: id } })).toBe(0);
  });

  it("finishes legacy sessions already saved in reflection without inventing an earlier explanation", async () => {
    const { id } = await reachExperienceLimit();
    const runtime = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime);
    // Recreate the persisted state produced by the old experience-limit transition.
    runtime.v12!.pedagogicalStage = "REFLECTION";
    runtime.v12!.activityType = "REFLECTION_REVISION";
    runtime.v12!.stageTransitions.at(-1)!.toStage = "REFLECTION";
    await prisma.learningSession.update({ where: { id }, data: { knowledgeRuntime: runtime as Prisma.InputJsonValue } });
    const final = await submitFeynmanExplanation(id, { explanation: revision, clientRequestId: `legacy-revision-${id}` });
    expect(final.payload.session.phase).toBe("COMPLETED");
    expect(final.report!.evidenceAudit!.finalFeynmanMessageId).toBeNull();
    expect(final.report!.evidenceAudit!.finalRevisionMessageId).toBeTruthy();
    expect(final.report!.dimensions.transferAbility.score).toBeLessThanOrEqual(50);
  });
});
