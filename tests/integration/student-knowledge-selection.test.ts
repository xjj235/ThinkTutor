import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { POST as createRoute } from "@/app/api/sessions/route";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { buildLearningContext } from "@/lib/ai/context-builder";
import type { AuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getStudentKnowledgeCatalog } from "@/lib/knowledge/student-catalog";
import { createLearningSession, createRetrySession } from "@/lib/session-service";
import { createTestUser } from "../factories";

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => {
    if (!auth.user) throw new Error("Missing test user");
    return auth.user;
  },
}));

const clientTask = {
  referenceText: undefined,
  course: "客户端伪课程", chapter: "客户端伪章节", topic: "系统性风险",
  objective: "客户端试图改为系统性风险的目标", learnerLevel: "入门",
};
const envelopeSchema = z.object({
  data: z.object({ session: z.object({ id: z.string(), topic: z.string(), objective: z.string() }) }),
});

function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function userId(): string {
  if (!auth.user) throw new Error("Missing test user");
  return auth.user.id;
}

// A completed-report fixture isolates retry routing without replaying the
// learning loop already covered by the core flow tests.
async function completeWithGapFixture(sessionId: string, repairObjective: string): Promise<void> {
  await prisma.learningSession.update({ where: { id: sessionId }, data: { phase: "COMPLETED", completedAt: new Date() } });
  const dimensionKeys = ["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"] as const;
  await prisma.learningReport.create({
    data: {
      sessionId, summary: "重练路由测试夹具", overallScore: 60,
      overallLevel: "发展中", disclaimer: "仅用于自动化测试的构造报告。",
      dimensions: { create: dimensionKeys.map((key) => ({ key, score: 60, evidence: "测试夹具证据", feedback: "补充头寸方向" })) },
      gaps: { create: [{ title: "外币应收方向", evidence: "测试夹具中的方向缺口", repairTask: repairObjective, priority: 5 }] },
    },
  });
}

describe("student knowledge selections create ordinary learning sessions", () => {
  beforeEach(async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000");
    auth.user = await createTestUser("student-knowledge-selection");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (auth.user) await prisma.learningSession.deleteMany({ where: { userId: auth.user.id } });
    auth.user = null;
  });

  it.each([
    "exchange-rate-risk", "economic-cycle-risk", "interest-rate-risk", "inflation-risk", "policy-risk",
  ])("resolves the whole %s selection on the server before creating the session", async (topicId) => {
    const topic = getStudentKnowledgeCatalog().find((item) => item.id === topicId);
    if (!topic) throw new Error(`Missing catalog topic ${topicId}`);
    const created = await createLearningSession(userId(), { ...clientTask, knowledgeSelection: { topicId } });
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: created.session.id } });
    expect(saved).toMatchObject({
      source: "SELF_DIRECTED", course: "金融风险管理", chapter: topic.title,
      topic: topic.title, objective: topic.objective, phase: "DIAGNOSIS",
      courseId: null, chapterId: null, learningGoalId: null, assignmentId: null,
      knowledgeRuntime: null,
    });
    expect(created.messages.length).toBeGreaterThan(0);
  });

  it("persists a selected unit's canonical title and objective instead of client text", async () => {
    const topic = getStudentKnowledgeCatalog()[0];
    const unit = topic.units[2];
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    const created = await createLearningSession(userId(), {
      ...clientTask, knowledgeSelection: { topicId: topic.id, unitId: unit.id },
    });
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: created.session.id } });
    expect(saved.topic).toBe(`${topic.title} · ${unit.title}`);
    expect(saved.objective).toBe(unit.objective);
    expect(saved.course).toBe("金融风险管理");
    expect(saved.chapter).toBe(topic.title);
    expect(saved.knowledgeRuntime).toBeNull();
    expect(saved).not.toHaveProperty("knowledgeSelection");
    const request = diagnostic.mock.calls.at(-1)?.[0];
    expect(request?.task.topic).toBe(saved.topic);
    expect(request?.retrievedContext?.[0]).toContain(unit.id);
    expect(request?.knowledgePolicy).toBe("COURSE_KNOWLEDGE_FIRST");
  });

  it("creates the selected ordinary task with no draft source text when draft preview is disabled", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const topic = getStudentKnowledgeCatalog()[0];
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    const created = await createLearningSession(userId(), { ...clientTask, knowledgeSelection: { topicId: topic.id } });
    expect(created.session.topic).toBe(topic.title);
    expect(created.session.phase).toBe("DIAGNOSIS");
    expect(diagnostic.mock.calls.at(-1)?.[0].retrievedContext).toEqual([]);
    expect(diagnostic.mock.calls.at(-1)?.[0].knowledgePolicy).toBe("MODEL_FALLBACK");
  });

  it.each([
    { topicId: "unknown-risk" },
    { topicId: "exchange-rate-risk", unitId: "UNKNOWN_UNIT" },
    { topicId: "exchange-rate-risk", unitId: "M_IR_001" },
  ])("rejects invalid or cross-topic selection $topicId/$unitId without creating a session", async (knowledgeSelection) => {
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    const response = await createRoute(createRequest({ ...clientTask, knowledgeSelection, clientRequestId: crypto.randomUUID() }));
    expect(response.status).toBe(400);
    expect(await prisma.learningSession.count({ where: { userId: userId() } })).toBe(0);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it.each(["assignmentId", "courseId", "chapterId", "learningGoalId"])("rejects selection combined with %s through the API", async (scope) => {
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    const response = await createRoute(createRequest({
      ...clientTask, [scope]: "scope-record-000001", knowledgeSelection: { topicId: "exchange-rate-risk" },
      clientRequestId: crypto.randomUUID(),
    }));
    expect(response.status).toBe(400);
    expect(await prisma.learningSession.count({ where: { userId: userId() } })).toBe(0);
    expect(diagnostic).not.toHaveBeenCalled();
  });

  it("does not let model-generated gaps or errors override the selected topic", async () => {
    const topic = getStudentKnowledgeCatalog()[0];
    const unit = topic.units[2];
    const context = await buildLearningContext({
      topic: `${topic.title} · ${unit.title}`,
      objective: "比较外币应收的汇率风险与系统性风险。",
      phase: "SOCRATIC", messages: [],
      learnerState: {
        masteryEstimate: 20, confirmedPoints: [], gaps: ["M_SR_002"],
        misconceptions: ["ERR_E03_DIRECT_LINK_ONLY"],
      },
    });
    expect(context.retrievedContext).toHaveLength(3);
    expect(context.retrievedContext[0]).toContain(unit.id);
    const text = context.retrievedContext.join("\n");
    expect(text).not.toMatch(/(?:C|M|D|SQ|DQ|CASE)_SR_/u);
    expect(text).not.toContain("ERR_E03_DIRECT_LINK_ONLY");
  });

  it("keeps consecutive retries on the selected unit when repair objectives mention systemic risk", async () => {
    const topic = getStudentKnowledgeCatalog()[0];
    const unit = topic.units[2];
    const original = await createLearningSession(userId(), {
      ...clientTask, knowledgeSelection: { topicId: topic.id, unitId: unit.id },
    });
    const repairObjective = "区分外币应收的汇率风险与系统性风险，并说明头寸方向如何影响损益。";
    vi.spyOn(MockAIProvider.prototype, "createRetryTask").mockResolvedValue({
      topic: "系统性风险", objective: repairObjective, rationale: "围绕最高优先级缺口练习。",
    });
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    let parentSessionId = original.session.id;
    for (const attempt of [1, 2]) {
      await completeWithGapFixture(parentSessionId, repairObjective);
      const request = { clientRequestId: crypto.randomUUID() };
      const retry = await createRetrySession(parentSessionId, request);
      expect(retry.session.topic).toBe(`${topic.title} · ${unit.title}`);
      expect(retry.session.objective).toBe(repairObjective);
      expect(retry.session.parentSessionId).toBe(parentSessionId);
      const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: retry.session.id } });
      expect(saved.knowledgeRuntime).toBeNull();
      expect(diagnostic).toHaveBeenCalledTimes(attempt);
      const diagnosticInput = diagnostic.mock.calls.at(-1)?.[0];
      expect(diagnosticInput?.task.topic).toBe(original.session.topic);
      expect(diagnosticInput?.retrievedContext?.[0]).toContain(unit.id);
      expect(diagnosticInput?.retrievedContext?.join("\n")).not.toMatch(/(?:C|SQ)_SR_/u);
      const duplicate = await createRetrySession(parentSessionId, request);
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.session.id).toBe(retry.session.id);
      parentSessionId = retry.session.id;
    }
  });

  it("keeps a selected API creation idempotent and preserves the first canonical task", async () => {
    const [firstTopic, secondTopic] = getStudentKnowledgeCatalog();
    const clientRequestId = crypto.randomUUID();
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    const first = await createRoute(createRequest({ ...clientTask, knowledgeSelection: { topicId: firstTopic.id }, clientRequestId }));
    expect(first.status).toBe(201);
    const firstPayload = envelopeSchema.parse(await first.json()).data;
    const duplicate = await createRoute(createRequest({ ...clientTask, knowledgeSelection: { topicId: secondTopic.id }, clientRequestId }));
    expect(duplicate.status).toBe(201);
    const duplicatePayload = envelopeSchema.parse(await duplicate.json()).data;
    expect(duplicatePayload.session.id).toBe(firstPayload.session.id);
    expect(duplicatePayload.session.topic).toBe(firstTopic.title);
    expect(await prisma.learningSession.count({ where: { userId: userId(), clientRequestId } })).toBe(1);
    expect(diagnostic).toHaveBeenCalledTimes(1);
  });
});
