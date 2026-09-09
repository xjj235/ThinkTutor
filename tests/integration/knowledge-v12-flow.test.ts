import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { createLearningSession as createUnconfirmedSession, submitLearningAnswer, submitFeynmanExplanation, getSessionPayload } from "@/lib/session-service";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { createTestUser } from "../factories";
import { reviewRelease, reviewClaim } from "@/lib/knowledge/review-service";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { POST as feynmanRoute } from "@/app/api/sessions/[id]/feynman/route";
import { POST as reviewRoute } from "@/app/api/teacher/knowledge/route";
import type { AuthUser } from "@/lib/auth/session";
import { Prisma } from "@prisma/client";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { createVersionSnapshot, getRuntimeManifests, resolveRuntimeManifest } from "@/lib/knowledge/releases";
import { goldenSetSchema } from "@/lib/knowledge/review-schemas";

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => auth.user }));
const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "系统性风险", objective: "解释金融风险传播及条件", learnerLevel: "有基础" };
async function createLearningSession(...args: Parameters<typeof createUnconfirmedSession>) {
  const payload = await createUnconfirmedSession(...args);
  expect(payload.session.knowledgeProgress?.pedagogicalStage).toBe("GOAL_PRESENTATION");
  return submitV12SessionEvent(payload.session.id, { action: "GOAL_CONFIRMED", clientRequestId: `goal-${payload.session.id}` });
}
export const completeAnswer = "首先，Systemic关注金融体系功能，Systematic是不可分散的市场风险，三类风险的研究对象不同，单家倒闭不等于系统性风险。例如初始冲击是房价下跌，因为没有直接借贷也可以通过共同持仓传播，多家机构同时受损；被迫抛售导致价格下跌并带来进一步损失，所以反馈放大导致金融功能受损。直接债权债务也能传递违约损失。集中提款增加现金需求，银行被迫出售长期资产。负面信息带来预期变化，其他银行也出现提款并跨机构扩散。信贷收缩导致投资与就业下降。规模不是唯一因素，还包括关联性与可替代性。个体自保形成同步行动与系统反馈。最后，如果关键服务很容易替代，那么金融功能未受损时就不能判断为系统性事件。";

describe("v1.2 transactional learning and teacher gates", () => {
  beforeEach(() => { vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await prisma.knowledgeRelease.deleteMany(); });
  it.each(["否", `${"答".repeat(20_001)}${completeAnswer}`])("processes short and long v1.2 answers without a hidden character gate", async (text) => {
    vi.stubEnv("MAX_USER_MESSAGE_LENGTH", "1");
    const assessment = vi.spyOn(MockAIProvider.prototype, "assessLearningTurn");
    const teaching = vi.spyOn(MockAIProvider.prototype, "selectTeachingMove");
    const user = await createTestUser("v12-input-length"); auth.user = user;
    const id = (await createLearningSession(user.id, task)).session.id;
    const result = await submitLearningAnswer(id, { answer: text, clientRequestId: `length-${id}` });
    expect(result.messages.some((m) => m.role === "USER" && m.content === text)).toBe(true);
    expect(assessment.mock.calls.at(-1)?.[0].message.content).toBe(text);
    expect(teaching.mock.calls.at(-1)?.[0].studentContent).toBe(text);
    expect(result.session.phase).not.toBe("COMPLETED");
  });
  it("runs diagnosis, unseen transfer, Feynman, revision and evidence report through the API", async () => {
    const assessmentSpy = vi.spyOn(MockAIProvider.prototype, "assessLearningTurn");
    const teachingSpy = vi.spyOn(MockAIProvider.prototype, "selectTeachingMove");
    const user = await createTestUser("v12-full"); auth.user = user;
    let payload = await createLearningSession(user.id, task);
    const id = payload.session.id;
    for (let i = 0; i < 5; i++) {
      payload = await submitLearningAnswer(id, { answer: `${completeAnswer}这是第${i}题的自主回答。`, clientRequestId: `v12-${id}-d${i}` });
      if (i === 0) expect(payload.session.phase).toBe("DIAGNOSIS");
    }
    expect(payload.session.knowledgeProgress?.pedagogicalStage).toBe("CASE_TRANSFER");
    for (let i = 0; i < 3; i++) payload = await submitLearningAnswer(id, { answer: `${completeAnswer}繁荣时杠杆上升形成风险累积，支付清算故障可以导致支付中断。这是新情境${i}的判断。`, clientRequestId: `v12-${id}-c${i}` });
    expect(payload.session.knowledgeProgress?.pedagogicalStage).toBe("FEYNMAN_OUTPUT");
    const response = await feynmanRoute(new Request(`http://localhost/api/sessions/${id}/feynman`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ explanation: `${completeAnswer}这是我的完整讲解。`, clientRequestId: `v12-${id}-f` }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data.report).toBeNull();
    expect(result.data.payload.session.knowledgeProgress.pedagogicalStage).toBe("REFLECTION");
    expect(assessmentSpy.mock.calls.at(-1)?.[0].lockedContext.questionText).toBe("请面向初学者自主解释系统性风险是什么、为什么传播，并用一个有机制的例子串联你的解释。");
    const revision = await submitFeynmanExplanation(id, { explanation: `${completeAnswer}这是经条件核验后的最终修订。`, clientRequestId: `v12-${id}-r` });
    expect(revision.payload.session.phase).toBe("COMPLETED");
    expect(teachingSpy.mock.calls.map(([input]) => input.kind)).toEqual(expect.arrayContaining(["GOAL", "DIAGNOSIS", "CASE", "FEYNMAN", "REFLECTION", "REPORT"]));
    expect(assessmentSpy.mock.calls.at(-1)?.[0].lockedContext.questionText).toContain("你能补充关键因果联系并用自己的话修订解释吗");
    for (const [input] of assessmentSpy.mock.calls) {
      expect(input.evaluationRules?.CURRENT_QUESTION).toBeDefined();
      expect(input.lockedContext.questionText).not.toContain("原文依据");
      expect(input.lockedContext.questionText).not.toContain("本轮相关依据");
      expect(input.lockedContext.questionText).not.toContain("自主回答");
    }
    expect(revision.report?.sessionVersions?.releaseId).toBe("KR_SR_1_2");
    const report = revision.report!;
    const ids = new Set(revision.payload.messages.filter((m) => m.role === "USER").map((m) => m.id));
    for (const refs of Object.values(report.evidenceLinks!)) { expect(refs.length).toBeGreaterThan(0); refs.forEach((id) => expect(ids.has(id)).toBe(true)); }
    expect(Object.values(report.dimensions).every((d) => [0, 25, 50, 75, 100].includes(d.score))).toBe(true);
    expect((await getSessionPayload(id)).report).toEqual(report);
    const duplicate = await submitFeynmanExplanation(id, { explanation: completeAnswer, clientRequestId: `v12-${id}-r` });
    expect(duplicate.duplicate).toBe(true);
    const administrator = await createTestUser("v12-report-auditor", "ADMIN");
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const claim = Object.values(knowledgeRuntimeSchema.parse(saved.knowledgeRuntime).v12!.gapStates)[0];
    await reviewClaim(administrator, { sessionId: id, version: saved.version, claimId: claim.claimId, action: "NEED_MORE_EVIDENCE", note: "测试后续复核不改写历史报告" });
    expect((await getSessionPayload(id)).report).toEqual(report);
  });
  it("rolls back fabricated evidence and rejects concurrent stale answers", async () => {
    const user = await createTestUser("v12-rollback");
    const payload = await createLearningSession(user.id, task);
    const id = payload.session.id;
    const before = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    vi.spyOn(MockAIProvider.prototype, "assessLearningTurn").mockResolvedValueOnce({ evidence: [{ messageId: "forged", evidenceId: "financial_system_scope", extractedText: "不在原文里" }], candidateMisconceptions: [], candidateGaps: [], candidateMastery: [], modelAssessmentConfidence: 1, contradictions: [], recommendTransition: true });
    await expect(submitLearningAnswer(id, { answer: completeAnswer, clientRequestId: `bad-${id}` })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).version).toBe(before.version);
    expect((await getSessionPayload(id)).messages).toHaveLength(2);
    const results = await Promise.allSettled([0, 1].map((i) => submitLearningAnswer(id, { answer: completeAnswer, clientRequestId: `parallel-${id}-${i}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("requires teacher ownership, current versions and real review material before publication", async () => {
    const student = await createTestUser("v12-review-student"); auth.user = student;
    const denied = await reviewRoute(new Request("http://localhost/api/teacher/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "CREATE" }) }));
    expect(denied.status).toBe(403);
    const teacher = await createTestUser("v12-review-teacher", "TEACHER");
    const other = await createTestUser("v12-review-other", "TEACHER");
    const release = await reviewRelease(teacher, { action: "CREATE" });
    expect(release.status).toBe("DRAFT");
    await expect(reviewRelease(other, { action: "ARCHIVE", version: release.version })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewRelease(teacher, { action: "REVIEW", version: release.version })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(reviewRelease(teacher, { action: "PUBLISH", version: release.version })).rejects.toMatchObject({ code: "CONFLICT" });
    const session = await createLearningSession(student.id, task);
    await expect(reviewClaim(other, { sessionId: session.session.id, version: 0, claimId: "ERR_E01_SYSTEMIC_SYSTEMATIC_CONFUSION", action: "CONFIRM", note: "测试访问边界" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const runtime = knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id: session.session.id } })).knowledgeRuntime);
    expect(runtime.v12?.misconceptionStates).toEqual({});
    const withSample = await reviewRelease(teacher, { action: "GOLDEN", version: release.version, sample: { studentAnswer: "工程测试样例，不属于真实的教师签署证据。", targetId: "C_SR_001", expectedEvidenceIds: [], expectedErrorIds: [], expectedLevel: "L1", dimensionAnchors: { conceptCompleteness: 0, logicCompleteness: 0, expressionClarity: 0, exampleAbility: 0, transferAbility: 0 } } });
    const sampleId = goldenSetSchema.parse(withSample.goldenSet)[0].id;
    await expect(reviewRelease(other, { action: "REMOVE_GOLDEN", version: withSample.version, sampleId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const removed = await reviewRelease(teacher, { action: "REMOVE_GOLDEN", version: withSample.version, sampleId });
    expect(removed.goldenSet).toEqual([]);
    expect(removed.modelValidation).toBeNull();
  });
  it("reserves distinct unseen cases across concurrent sessions for the same student", async () => {
    const user = await createTestUser("v12-exposure");
    const sessions = await Promise.all([createLearningSession(user.id, task), createLearningSession(user.id, task)]);
    for (const session of sessions) for (let i = 0; i < 4; i++) await submitLearningAnswer(session.session.id, { answer: `${completeAnswer}这是诊断${i}的自主回答。`, clientRequestId: `exposure-${session.session.id}-${i}` });
    await Promise.all(sessions.map((session) => submitLearningAnswer(session.session.id, { answer: `${completeAnswer}这是第五个问题的独立回答。`, clientRequestId: `exposure-${session.session.id}-final` })));
    const saved = await prisma.learningSession.findMany({ where: { id: { in: sessions.map((s) => s.session.id) } } });
    const states = saved.map((s) => knowledgeRuntimeSchema.parse(s.knowledgeRuntime));
    expect(new Set(states.map((s) => s.v12!.currentCaseId)).size).toBe(2);
    expect(states.every((s) => s.v12!.currentCaseUnseen)).toBe(true);
  });
  it("keeps JSONB publication hashes stable and archived versions available only to pinned sessions", async () => {
    const owner = await createTestUser("v12-test-release", "TEACHER");
    const manifest = buildV12Manifest();
    manifest.release.status = "published"; manifest.release.verifiedBy = owner.id; manifest.release.verifiedAt = new Date().toISOString();
    for (const source of manifest.sources) source.status = "reviewed";
    const versions = createVersionSnapshot(manifest);
    // Synthetic database fixture only, never a real teacher-approved release.
    await prisma.knowledgeRelease.create({ data: { id: manifest.release.id, ownerId: owner.id, status: "PUBLISHED", contentHash: versions.contentHash, manifest: manifest as unknown as Prisma.InputJsonValue, sourceReviews: [], goldenSet: [], verifiedBy: owner.id, verifiedAt: new Date() } });
    expect((await getRuntimeManifests()).some((m) => createVersionSnapshot(m).contentHash === versions.contentHash)).toBe(true);
    await prisma.knowledgeRelease.update({ where: { id: manifest.release.id }, data: { status: "ARCHIVED" } });
    expect((await getRuntimeManifests()).some((m) => m.release.id === manifest.release.id)).toBe(false);
    expect(createVersionSnapshot(await resolveRuntimeManifest(versions)).contentHash).toBe(versions.contentHash);
  });
});
