import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { POST as createSessionRoute } from "@/app/api/sessions/route";
import { GET as getSessionRoute } from "@/app/api/sessions/[id]/route";
import { POST as answerRoute } from "@/app/api/sessions/[id]/answers/route";
import { POST as hintRoute } from "@/app/api/sessions/[id]/hint/route";
import { POST as feynmanRoute } from "@/app/api/sessions/[id]/feynman/route";
import { POST as enterFeynmanRoute } from "@/app/api/sessions/[id]/feynman/enter/route";
import { POST as retryRoute } from "@/app/api/sessions/[id]/retry/route";
import { GET as reportRoute } from "@/app/api/reports/[sessionId]/route";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/errors";
import { createTestUser } from "../factories";

const authState = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string; role: "STUDENT" | "TEACHER" | "ADMIN" } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async (roles?: Array<"STUDENT" | "TEACHER" | "ADMIN">) => {
    if (!authState.user) throw new Error("test user missing");
    if (roles && !roles.includes(authState.user.role)) throw new Error("test role forbidden");
    return authState.user;
  },
}));

const sessionSchema = z.object({
  id: z.string(),
  phase: z.enum(["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "REPORTING", "COMPLETED", "ABANDONED"]),
  socraticTurns: z.number().int(),
  objective: z.string(),
  parentSessionId: z.string().nullable(),
});

const messageSchema = z.object({
  id: z.string(),
  content: z.string(),
  clientRequestId: z.string().nullable(),
});

const reportSchema = z.object({
  sessionId: z.string(),
  overallScore: z.number(),
  dimensions: z.object({
    conceptCompleteness: z.object({ score: z.number() }).passthrough(),
    logicCompleteness: z.object({ score: z.number() }).passthrough(),
    expressionClarity: z.object({ score: z.number() }).passthrough(),
    exampleAbility: z.object({ score: z.number() }).passthrough(),
    transferAbility: z.object({ score: z.number() }).passthrough(),
  }),
  gaps: z.array(
    z.object({
      title: z.string(),
      evidence: z.string(),
      repairTask: z.string(),
      priority: z.number().int().min(1).max(5),
    }),
  ),
});

const sessionEnvelopeSchema = z.object({
  requestId: z.string(),
  data: z.object({
    session: sessionSchema,
    messages: z.array(messageSchema),
    report: reportSchema.nullable(),
    duplicate: z.boolean().optional(),
  }),
});

const task = {
  course: "金融学导论",
  chapter: "风险",
  topic: "系统性风险",
  objective: "理解局部风险如何传导成整体风险",
  learnerLevel: "有基础",
  referenceText: "系统性风险可通过关联、杠杆、流动性和预期传导。",
};

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function reportContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

async function parseSessionResponse(response: Response) {
  return sessionEnvelopeSchema.parse(await response.json());
}

async function createSession() {
  const response = await createSessionRoute(
    jsonRequest("/api/sessions", task),
  );
  expect(response.status).toBe(201);
  return parseSessionResponse(response);
}

async function postAnswer(
  sessionId: string,
  answer: string,
  clientRequestId: string,
) {
  return answerRoute(
    jsonRequest(`/api/sessions/${sessionId}/answers`, {
      answer,
      clientRequestId,
    }),
    sessionContext(sessionId),
  );
}

async function cleanDb() {
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
}

describe("ThinkTutor API flow", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.AI_PROVIDER = "mock";
    await cleanDb();
    const user = await createTestUser("api-flow");
    authState.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("completes all endpoints with validation, idempotency, report, and retry", async () => {
    const created = await createSession();
    const sessionId = created.data.session.id;
    expect(created.data.session.phase).toBe("DIAGNOSIS");
    expect(created.data.messages).toHaveLength(1);

    const loadedResponse = await getSessionRoute(
      new Request(`http://localhost/api/sessions/${sessionId}`),
      sessionContext(sessionId),
    );
    expect(loadedResponse.status).toBe(200);
    expect((await parseSessionResponse(loadedResponse)).data.session.id).toBe(
      sessionId,
    );

    const hintRequest = jsonRequest(`/api/sessions/${sessionId}/hint`, {
      clientRequestId: "hint-request-001",
    });
    const hintResponse = await hintRoute(hintRequest, sessionContext(sessionId));
    expect(hintResponse.status).toBe(200);
    const hinted = await parseSessionResponse(hintResponse);
    expect(hinted.data.duplicate).toBe(false);

    const duplicateHintResponse = await hintRoute(
      jsonRequest(`/api/sessions/${sessionId}/hint`, {
        clientRequestId: "hint-request-001",
      }),
      sessionContext(sessionId),
    );
    const duplicateHint = await parseSessionResponse(duplicateHintResponse);
    expect(duplicateHint.data.duplicate).toBe(true);
    expect(duplicateHint.data.messages).toHaveLength(hinted.data.messages.length);

    const diagnosisResponse = await postAnswer(
      sessionId,
      "系统性风险是局部冲击通过机构联系扩散到整体市场。",
      "answer-diagnosis-api",
    );
    const afterDiagnosis = await parseSessionResponse(diagnosisResponse);
    expect(afterDiagnosis.data.session.phase).toBe("SOCRATIC");
    expect(afterDiagnosis.data.session.socraticTurns).toBe(0);

    const duplicateAnswerResponse = await postAnswer(
      sessionId,
      "重复提交不应该再次写入数据库消息。",
      "answer-diagnosis-api",
    );
    const duplicateAnswer = await parseSessionResponse(duplicateAnswerResponse);
    expect(duplicateAnswer.data.duplicate).toBe(true);
    expect(duplicateAnswer.data.messages).toHaveLength(
      afterDiagnosis.data.messages.length,
    );

    let current = afterDiagnosis;
    for (const [index, answer] of [
      "机构持有相似资产，因此一家抛售会影响其他机构。",
      "流动性下降会导致价格下跌，所以损失进一步放大。",
      "这一判断依赖机构之间存在共同敞口和信心联系。",
    ].entries()) {
      const response = await postAnswer(
        sessionId,
        answer,
        `answer-socratic-api-${index + 1}`,
      );
      current = await parseSessionResponse(response);
    }
    expect(current.data.session.phase).toBe("SOCRATIC");
    expect(current.data.session.socraticTurns).toBe(3);

    const enterResponse = await enterFeynmanRoute(
      jsonRequest(`/api/sessions/${sessionId}/feynman/enter`, {
        clientRequestId: "enter-feynman-api-001",
      }),
      sessionContext(sessionId),
    );
    current = await parseSessionResponse(enterResponse);
    expect(current.data.session.phase).toBe("FEYNMAN");

    const explanation =
      "系统性风险是局部冲击通过关联和流动性扩散成整体风险。例如一家机构抛售会压低资产价格，所以其他机构也会受损。如果迁移到供应链场景，需要检查节点关联和替代条件。";
    const feynmanResponse = await feynmanRoute(
      jsonRequest(`/api/sessions/${sessionId}/feynman`, {
        explanation,
        clientRequestId: "feynman-api-001",
      }),
      sessionContext(sessionId),
    );
    expect(feynmanResponse.status).toBe(200);
    const completed = z
      .object({
        requestId: z.string(),
        data: z.object({
          payload: z.object({ session: sessionSchema, report: reportSchema }),
          report: reportSchema,
          duplicate: z.boolean(),
        }),
      })
      .parse(await feynmanResponse.json());
    expect(completed.data.payload.session.phase).toBe("COMPLETED");

    const scores = completed.data.report.dimensions;
    const expectedOverall = Math.round(
      (scores.conceptCompleteness.score +
        scores.logicCompleteness.score +
        scores.expressionClarity.score +
        scores.exampleAbility.score +
        scores.transferAbility.score) /
        5,
    );
    expect(completed.data.report.overallScore).toBe(expectedOverall);

    const duplicateFeynmanResponse = await feynmanRoute(
      jsonRequest(`/api/sessions/${sessionId}/feynman`, {
        explanation,
        clientRequestId: "feynman-api-001",
      }),
      sessionContext(sessionId),
    );
    const duplicateFeynman = z
      .object({ requestId: z.string(), data: z.object({ duplicate: z.boolean() }) })
      .parse(await duplicateFeynmanResponse.json());
    expect(duplicateFeynman.data.duplicate).toBe(true);

    const reportResponse = await reportRoute(
      new Request(`http://localhost/api/reports/${sessionId}`),
      reportContext(sessionId),
    );
    expect(reportResponse.status).toBe(200);
    const reportBody = z
      .object({
        requestId: z.string(),
        data: z.object({ session: sessionSchema, report: reportSchema }),
      })
      .parse(await reportResponse.json());
    expect(reportBody.data.report.sessionId).toBe(sessionId);

    const retryResponse = await retryRoute(
      jsonRequest(`/api/sessions/${sessionId}/retry`, {
        clientRequestId: "retry-api-001",
      }),
      sessionContext(sessionId),
    );
    expect(retryResponse.status).toBe(201);
    const retry = await parseSessionResponse(retryResponse);
    expect(retry.data.session.parentSessionId).toBe(sessionId);
    expect(retry.data.session.phase).toBe("DIAGNOSIS");
    const priorityGap = completed.data.report.gaps[0];
    expect(priorityGap).toBeDefined();
    if (!priorityGap) throw new Error("Expected at least one report gap.");
    expect(retry.data.session.objective).toContain(priorityGap.title);
    expect(retry.data.session.objective).toContain(priorityGap.repairTask);

    const duplicateRetryResponse = await retryRoute(
      jsonRequest(`/api/sessions/${sessionId}/retry`, {
        clientRequestId: "retry-api-001",
      }),
      sessionContext(sessionId),
    );
    expect(duplicateRetryResponse.status).toBe(200);
    const duplicateRetry = await parseSessionResponse(duplicateRetryResponse);
    expect(duplicateRetry.data.duplicate).toBe(true);
    expect(duplicateRetry.data.session.id).toBe(retry.data.session.id);
  });

  it("lets the learner enter Feynman after three rounds and deduplicates the action", async () => {
    const created = await createSession();
    const sessionId = created.data.session.id;
    await postAnswer(
      sessionId,
      "系统性风险会通过机构之间的资产关联向外扩散。",
      "manual-diagnosis",
    );
    for (let round = 1; round <= 3; round += 1) {
      await postAnswer(
        sessionId,
        `这是第 ${round} 轮完整回答，我会说明条件、机制与结果之间的关系。`,
        `manual-round-${round}`,
      );
    }

    const requestBody = { clientRequestId: "manual-enter-feynman-001" };
    const firstResponse = await enterFeynmanRoute(
      jsonRequest(`/api/sessions/${sessionId}/feynman/enter`, requestBody),
      sessionContext(sessionId),
    );
    expect(firstResponse.status).toBe(200);
    const first = await parseSessionResponse(firstResponse);
    expect(first.data.session.phase).toBe("FEYNMAN");
    expect(first.data.session.socraticTurns).toBe(3);
    expect(first.data.duplicate).toBe(false);

    const duplicateResponse = await enterFeynmanRoute(
      jsonRequest(`/api/sessions/${sessionId}/feynman/enter`, requestBody),
      sessionContext(sessionId),
    );
    const duplicate = await parseSessionResponse(duplicateResponse);
    expect(duplicate.data.duplicate).toBe(true);
    expect(duplicate.data.messages).toHaveLength(first.data.messages.length);
  });

  it("forces FEYNMAN after the configured sixth Socratic answer", async () => {
    vi.spyOn(MockAIProvider.prototype, "createCoachTurn").mockImplementation(
      async () => ({
        assistantMessage: "请继续说明这个判断依赖的关键条件是什么？",
        questionType: "ASSUMPTION_TEST",
        learnerState: { masteryEstimate: 50, confirmedPoints: [], gaps: [], misconceptions: [] },
        nextAction: "ASK_QUESTION",
        transitionReason: "继续测试最大轮次。",
      }),
    );
    const created = await createSession();
    const sessionId = created.data.session.id;
    await postAnswer(
      sessionId,
      "我认为风险会通过机构之间的资产联系扩散。",
      "max-round-diagnosis",
    );

    let currentPhase = "SOCRATIC";
    let currentRound = 0;
    for (let round = 1; round <= 6; round += 1) {
      const response = await postAnswer(
        sessionId,
        `这是第 ${round} 轮回答，我会继续解释风险传导的条件和结果。`,
        `max-round-answer-${round}`,
      );
      const body = await parseSessionResponse(response);
      currentPhase = body.data.session.phase;
      currentRound = body.data.session.socraticTurns;
    }

    expect(currentPhase).toBe("FEYNMAN");
    expect(currentRound).toBe(6);
  });

  it("deduplicates concurrent answer requests with the same clientRequestId", async () => {
    const created = await createSession();
    const sessionId = created.data.session.id;
    const responses = await Promise.all([
      postAnswer(
        sessionId,
        "并发提交时只应保存这一条学生回答。",
        "concurrent-answer-001",
      ),
      postAnswer(
        sessionId,
        "并发提交时只应保存这一条学生回答。",
        "concurrent-answer-001",
      ),
    ]);
    expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
    const successfulBodies = await Promise.all(responses.filter((response) => response.status === 200).map(parseSessionResponse));
    expect(successfulBodies.some((body) => body.data.duplicate === false)).toBe(true);
    expect(
      await prisma.message.count({
        where: { sessionId, clientRequestId: "concurrent-answer-001" },
      }),
    ).toBe(1);
  });

  it("returns unified validation and provider errors without advancing state", async () => {
    const invalidResponse = await createSessionRoute(
      jsonRequest("/api/sessions", { topic: "" }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", retryable: false },
    });

    const invalidJsonResponse = await createSessionRoute(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", retryable: false },
    });

    const missingResponse = await getSessionRoute(
      new Request("http://localhost/api/sessions/missing-session"),
      sessionContext("missing-session"),
    );
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toMatchObject({
      error: { code: "NOT_FOUND", retryable: false },
    });

    const created = await createSession();
    const sessionId = created.data.session.id;
    vi.spyOn(MockAIProvider.prototype, "createCoachTurn").mockRejectedValueOnce(
      new AIProviderError("AI_TIMEOUT", "模型超时。", 503, true),
    );

    const failedAnswer = await postAnswer(
      sessionId,
      "这条回答不能被写入数据库。",
      "api-provider-failure",
    );
    expect(failedAnswer.status).toBe(503);
    expect(await failedAnswer.json()).toMatchObject({
      error: {
        code: "AI_TIMEOUT",
        message: "模型超时。",
        retryable: true,
      }, requestId: expect.any(String),
    });

    const persisted = await prisma.learningSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { messages: true },
    });
    expect(persisted.phase).toBe("DIAGNOSIS");
    expect(persisted.socraticTurns).toBe(0);
    expect(persisted.messages).toHaveLength(1);
  });

  it("validates every API body and dynamic route parameter", async () => {
    const created = await createSession();
    const sessionId = created.data.session.id;

    const invalidResponses = await Promise.all([
      createSessionRoute(
        jsonRequest("/api/sessions", { ...task, unexpected: true }),
      ),
      answerRoute(
        jsonRequest(`/api/sessions/${sessionId}/answers`, {
          answer: "",
          clientRequestId: "short",
        }),
        sessionContext(sessionId),
      ),
      hintRoute(
        jsonRequest(`/api/sessions/${sessionId}/hint`, {
          clientRequestId: "short",
        }),
        sessionContext(sessionId),
      ),
      feynmanRoute(
        jsonRequest(`/api/sessions/${sessionId}/feynman`, {
          explanation: "太短",
          clientRequestId: "feynman-valid-id",
        }),
        sessionContext(sessionId),
      ),
      enterFeynmanRoute(
        jsonRequest(`/api/sessions/${sessionId}/feynman/enter`, {
          clientRequestId: "short",
        }),
        sessionContext(sessionId),
      ),
      retryRoute(
        jsonRequest(`/api/sessions/${sessionId}/retry`, {
          clientRequestId: "short",
        }),
        sessionContext(sessionId),
      ),
      getSessionRoute(
        new Request("http://localhost/api/sessions/invalid"),
        sessionContext(""),
      ),
      reportRoute(
        new Request("http://localhost/api/reports/invalid"),
        reportContext(""),
      ),
    ]);

    for (const response of invalidResponses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR", retryable: false },
      });
    }
  });

  it("rejects unauthorized curriculum ids for self-directed sessions", async () => {
    if (!authState.user) throw new Error("Expected an authenticated test user.");
    const teacher = await createTestUser("curriculum-owner", "TEACHER");
    const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "未授权测试课程", status: "PUBLISHED" } });
    const chapter = await prisma.chapter.create({ data: { courseId: course.id, title: "未授权章节", sortOrder: 1 } });

    const unauthorized = await createSessionRoute(jsonRequest("/api/sessions", {
      courseId: course.id,
      topic: "不能访问的知识点",
      objective: "未加入课程的学生不应使用其材料上下文。",
      learnerLevel: "入门",
    }));
    expect(unauthorized.status).toBe(403);

    const allowedCourse = await prisma.course.create({ data: { ownerId: teacher.id, title: "已授权测试课程", status: "PUBLISHED" } });
    const classroom = await prisma.classroom.create({ data: { courseId: allowedCourse.id, teacherId: teacher.id, name: "授权班级", joinCode: `API${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}` } });
    await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: authState.user.id } });
    const mixedHierarchy = await createSessionRoute(jsonRequest("/api/sessions", {
      courseId: allowedCourse.id,
      chapterId: chapter.id,
      topic: "混用章节",
      objective: "不能混用其他课程的章节标识。",
      learnerLevel: "入门",
    }));
    expect(mixedHierarchy.status).toBe(400);
  });
});
