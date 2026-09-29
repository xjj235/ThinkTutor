import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "@/lib/ai";
import * as redis from "@/lib/redis";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { getServerEnv, resetServerEnvForTests } from "@/lib/env";
import { prisma } from "@/lib/db";
import { createLearningSession, createRetrySession } from "@/lib/session-service";
import { createTestUser } from "../factories";
import { POST as createSessionRoute } from "@/app/api/sessions/route";

const authState = vi.hoisted(() => ({ user: null as null | { id: string; role: "STUDENT" } }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => {
  if (!authState.user) throw new Error("Missing synthetic test user");
  return authState.user;
} }));

const task = { course: undefined, chapter: undefined, topic: "三角形中的边与角", objective: "说明目前对边角关系的理解", learnerLevel: "入门", referenceText: "直角所对的边称为斜边。" };
const pass = { minimumAnswer: "学生说明自己的理解，也可以表示不知道。", attributedStudentClaims: [], missingInformationQuote: null, questionAnswerable: true, singleMainQuestion: true, noAnswerLeak: true, answerLeakQuote: null };
const draft = { assistantMessage: "你目前如何理解三角形中的边与角？", questionType: "CONCEPT_CLARIFICATION", learnerState: { masteryEstimate: 90, confirmedPoints: ["资料里出现了斜边"], gaps: ["尚未观察的缺口"], misconceptions: ["未经证实的错误"] }, nextAction: "ASK_QUESTION", transitionReason: "模型自行假定已有理解" };
const completion = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
const userIds: string[] = [];

async function completedParent(label: string) {
  const student = await createTestUser(label); userIds.push(student.id);
  return prisma.learningSession.create({
    data: {
      ...task, userId: student.id, phase: "COMPLETED", completedAt: new Date(), socraticTurns: 3, version: 4,
      learnerState: { masteryEstimate: 60, confirmedPoints: ["原会话已说明三角形有三条边"], gaps: ["边与角的对应"], misconceptions: [] },
      messages: { create: [
        { role: "USER", phase: "SOCRATIC", content: "原会话：我知道三角形有三条边，还不能说明边和角的对应。" },
        { role: "USER", phase: "FEYNMAN", content: "原会话独立讲解：三角形有三条边，边角对应还需要补充。" },
      ] },
      report: { create: {
        summary: "需要继续验证边与角的对应", overallScore: 60, overallLevel: "发展中", disclaimer: "合成回归测试报告",
        gaps: { create: { title: "边与角的对应", evidence: "原讲解未说明对应关系", repairTask: "在新问题中说明边角对应。", priority: 5 } },
      } },
    },
    include: { messages: { orderBy: { id: "asc" } }, report: { include: { gaps: true } } },
  });
}

describe("reviewed initial diagnosis persistence", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-server-key");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false");
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "45000");
    vi.stubEnv("AI_MAX_RETRIES", "0");
    resetServerEnvForTests();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetServerEnvForTests(); });
  afterAll(async () => {
    await prisma.learningSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("stores only a reviewed question and clears invented initial evidence within a two-call lock", async () => {
    const student = await createTestUser("diagnostic-reviewed"); userIds.push(student.id);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(draft)).mockResolvedValueOnce(completion(pass));
    vi.spyOn(ai, "getAIProvider").mockReturnValue(new DeepSeekProvider({ fetcher }));
    const lock = vi.spyOn(redis, "acquireLock");
    const result = await createLearningSession(student.id, task, { clientRequestId: "reviewed-diagnostic-create" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenCalledWith("lock:ai:create:reviewed-diagnostic-create", 100_000);
    expect(result.session.phase).toBe("DIAGNOSIS");
    expect(result.session.socraticTurns).toBe(0);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe(draft.assistantMessage);
    const stored = await prisma.learningSession.findUniqueOrThrow({ where: { id: result.session.id } });
    expect(stored.learnerState).toEqual({ masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] });
    const requestBody = String(fetcher.mock.calls[1]?.[1]?.body);
    expect(JSON.parse(requestBody)).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low", max_tokens: 4000 });
    expect(requestBody).toContain("你是首轮诊断问题复核模块");
    expect(requestBody).not.toContain("模型自行假定已有理解");
  });

  it("does not create a session after rejected initial questions and does not nest review retries", async () => {
    vi.stubEnv("AI_MAX_RETRIES", "1"); resetServerEnvForTests();
    const student = await createTestUser("diagnostic-rejected"); userIds.push(student.id);
    const bad = { ...draft, assistantMessage: "在这个具体三角形里，哪条边是斜边？" };
    const rejected = { ...pass, minimumAnswer: "没有给出具体三角形，不能定位。", missingInformationQuote: "这个具体三角形", questionAnswerable: false };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(bad)).mockResolvedValueOnce(completion(rejected))
      .mockResolvedValueOnce(completion(bad)).mockResolvedValueOnce(completion(rejected));
    vi.spyOn(ai, "getAIProvider").mockReturnValue(new DeepSeekProvider({ fetcher }));
    const lock = vi.spyOn(redis, "acquireLock");
    await expect(createLearningSession(student.id, task, { clientRequestId: "rejected-diagnostic-create" })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(lock).toHaveBeenCalledWith("lock:ai:create:rejected-diagnostic-create", 190_000);
    expect(await prisma.learningSession.count({ where: { userId: student.id } })).toBe(0);
    expect(await prisma.message.count({ where: { session: { userId: student.id } } })).toBe(0);
  });

  it("retries an attributed reference claim before persisting a clean first question", async () => {
    vi.stubEnv("AI_MAX_RETRIES", "1"); resetServerEnvForTests();
    const student = await createTestUser("diagnostic-repaired"); userIds.push(student.id);
    const bad = { ...draft, assistantMessage: "你提到斜边，那么它有什么特征？" };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(bad)).mockResolvedValueOnce(completion({ ...pass, attributedStudentClaims: ["你提到斜边"] }))
      .mockResolvedValueOnce(completion(draft)).mockResolvedValueOnce(completion(pass));
    vi.spyOn(ai, "getAIProvider").mockReturnValue(new DeepSeekProvider({ fetcher }));
    const result = await createLearningSession(student.id, task, { clientRequestId: "repaired-diagnostic-create" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe(draft.assistantMessage);
    expect(await prisma.message.count({ where: { sessionId: result.session.id, content: bad.assistantMessage } })).toBe(0);
  });

  it("returns a retryable API error without creating records when the initial review fails", async () => {
    const student = await createTestUser("diagnostic-api-rejected"); userIds.push(student.id);
    authState.user = { id: student.id, role: "STUDENT" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(completion(draft))
      .mockResolvedValueOnce(completion({ ...pass, questionAnswerable: false, minimumAnswer: "题目不能作答。" }));
    vi.spyOn(ai, "getAIProvider").mockReturnValue(new DeepSeekProvider({ fetcher }));
    const origin = new URL(getServerEnv().APP_URL).origin;
    const response = await createSessionRoute(new Request(`${origin}/api/sessions`, {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ ...task, clientRequestId: "api-rejected-diagnostic-create" }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "AI_INVALID_OUTPUT", retryable: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await prisma.learningSession.count({ where: { userId: student.id } })).toBe(0);
  });

  it("reviews the retry diagnostic with a two-call lock before creating the child and claiming its gap", async () => {
    const parent = await completedParent("retry-diagnostic-reviewed");
    const gap = parent.report!.gaps[0];
    const requestId = "reviewed-retry-diagnostic";
    const retryTask = { topic: task.topic, objective: "在新情形中解释边与角的对应", rationale: "原报告需要补充边角对应" };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(retryTask))
      .mockResolvedValueOnce(completion(draft))
      .mockResolvedValueOnce(completion(pass));
    vi.spyOn(ai, "getAIProvider").mockReturnValue(new DeepSeekProvider({ fetcher }));
    const lock = vi.spyOn(redis, "acquireLock");

    const result = await createRetrySession(parent.id, { clientRequestId: requestId });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(lock).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenNthCalledWith(1, `lock:ai:${parent.id}`, 55_000);
    expect(lock).toHaveBeenNthCalledWith(2, `lock:ai:${parent.id}:retry`, 100_000);
    expect(result).toMatchObject({ duplicate: false, session: { phase: "DIAGNOSIS", socraticTurns: 0, parentSessionId: parent.id } });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe(draft.assistantMessage);
    const child = await prisma.learningSession.findUniqueOrThrow({ where: { id: result.session.id } });
    expect(child).toMatchObject({ source: "RETRY", sourceGapId: gap.id, learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] } });
    expect(await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).toMatchObject({ status: "IN_PROGRESS" });
    expect(await prisma.message.findUniqueOrThrow({ where: { clientRequestId: requestId } })).toMatchObject({ sessionId: parent.id, role: "SYSTEM", metadata: { retrySessionId: child.id } });
    const reviewRequest = String(fetcher.mock.calls[2]?.[1]?.body);
    expect(reviewRequest).toContain("你是首轮诊断问题复核模块");
    for (const message of parent.messages) expect(reviewRequest).not.toContain(message.content);
  });

  it("leaves the retry gap, parent and child records untouched after all diagnostic reviews reject", async () => {
    vi.stubEnv("AI_MAX_RETRIES", "1"); resetServerEnvForTests();
    const parent = await completedParent("retry-diagnostic-rejected");
    const requestId = "rejected-retry-diagnostic";
    const retryTask = { topic: task.topic, objective: "在新情形中解释边与角的对应", rationale: "原报告需要补充边角对应" };
    const bad = { ...draft, assistantMessage: "图中的三角形ABC里，哪条边是斜边？" };
    const rejected = { ...pass, minimumAnswer: "没有给出图，不能定位。", missingInformationQuote: "图中的三角形ABC", questionAnswerable: false };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(retryTask))
      .mockResolvedValueOnce(completion(bad)).mockResolvedValueOnce(completion(rejected))
      .mockResolvedValueOnce(completion(bad)).mockResolvedValueOnce(completion(rejected));
    vi.spyOn(ai, "getAIProvider").mockReturnValue(new DeepSeekProvider({ fetcher }));
    const lock = vi.spyOn(redis, "acquireLock");

    await expect(createRetrySession(parent.id, { clientRequestId: requestId })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT", retryable: true });

    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(lock).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenNthCalledWith(1, `lock:ai:${parent.id}`, 100_000);
    expect(lock).toHaveBeenNthCalledWith(2, `lock:ai:${parent.id}:retry`, 190_000);
    expect(await prisma.learningSession.findUniqueOrThrow({
      where: { id: parent.id }, include: { messages: { orderBy: { id: "asc" } }, report: { include: { gaps: true } } },
    })).toEqual(parent);
    expect(parent.report!.gaps[0]?.status).toBe("OPEN");
    expect(await prisma.learningSession.count({ where: { userId: parent.userId } })).toBe(1);
    expect(await prisma.learningSession.count({ where: { parentSessionId: parent.id } })).toBe(0);
    expect(await prisma.message.findUnique({ where: { clientRequestId: requestId } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { actorId: parent.userId, action: "SESSION_CREATED" } })).toBe(0);
  });
});
