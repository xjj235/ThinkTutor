import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/errors";
import { createTestUser } from "../factories";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import {
  createLearningSession,
  createRetrySession,
  enterLearningFeynman,
  submitFeynmanExplanation,
  submitLearningAnswer,
  requestHint,
  getSessionPayload,
} from "@/lib/session-service";

const task = {
  course: "金融学导论",
  chapter: "风险",
  topic: "系统性风险",
  objective: "理解局部风险如何传导成整体风险",
  learnerLevel: "有基础",
  referenceText: "系统性风险可通过关联、杠杆、流动性和预期传导。",
};

async function cleanDb() {
  await prisma.learningReport.deleteMany();
  await prisma.message.deleteMany();
  await prisma.learningSession.deleteMany();
  await prisma.assignmentStudent.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.classroom.deleteMany();
  await prisma.learningGoal.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.course.deleteMany();
}

async function createAssignedTask(studentId: string, options?: { openAt?: Date; dueAt?: Date; maxAttempts?: number }) {
  const teacher = await createTestUser(`assignment-teacher-${crypto.randomUUID()}`, "TEACHER");
  const course = await prisma.course.create({
    data: { ownerId: teacher.id, title: `课程 ${crypto.randomUUID()}`, status: "PUBLISHED" },
  });
  const classroom = await prisma.classroom.create({
    data: { teacherId: teacher.id, courseId: course.id, name: "测试班级", joinCode: crypto.randomUUID().slice(0, 8).toUpperCase() },
  });
  await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: studentId } });
  const assignment = await prisma.assignment.create({
    data: {
      courseId: course.id,
      classroomId: classroom.id,
      createdById: teacher.id,
      title: "系统性风险任务",
      instructions: "请通过追问和费曼讲解说明系统性风险。",
      learnerLevel: "入门",
      status: "PUBLISHED",
      publishedAt: new Date(),
      openAt: options?.openAt,
      dueAt: options?.dueAt,
      maxAttempts: options?.maxAttempts ?? 1,
    },
  });
  await prisma.assignmentStudent.create({ data: { assignmentId: assignment.id, studentId } });
  return assignment;
}

describe("learning session integration flow", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("creates a session, completes the loop, and creates a retry session", async () => {
    const user = await createTestUser("flow-complete");
    const created = await createLearningSession(user.id, task);
    expect(created.session.phase).toBe("DIAGNOSIS");
    expect(created.messages[0]?.content).toContain("系统性风险");

    const afterDiagnosis = await submitLearningAnswer(created.session.id, {
      answer: "我认为系统性风险是单个机构问题扩散到整个市场。",
      clientRequestId: "answer-diagnosis",
    });
    expect(afterDiagnosis.session.phase).toBe("SOCRATIC");
    expect(afterDiagnosis.session.socraticTurns).toBe(0);

    const duplicate = await submitLearningAnswer(created.session.id, {
      answer: "这次重复提交不应该再次写入数据库。",
      clientRequestId: "answer-diagnosis",
    });
    expect(duplicate.duplicate).toBe(true);

    const round1 = await submitLearningAnswer(created.session.id, {
      answer: "关键概念是传染，因为机构之间有资产和信心联系。",
      clientRequestId: "answer-round-1",
    });
    expect(round1.session.phase).toBe("SOCRATIC");
    expect(round1.session.socraticTurns).toBe(1);

    const round2 = await submitLearningAnswer(created.session.id, {
      answer: "如果流动性下降，会导致抛售和价格下跌。",
      clientRequestId: "answer-round-2",
    });
    expect(round2.session.phase).toBe("SOCRATIC");
    expect(round2.session.socraticTurns).toBe(2);

    const round3 = await submitLearningAnswer(created.session.id, {
      answer: "前提是机构之间存在共同风险敞口，因此局部冲击会放大。",
      clientRequestId: "answer-round-3",
    });
    expect(round3.session.phase).toBe("SOCRATIC");
    expect(round3.session.socraticTurns).toBe(3);

    const feynmanPhase = await submitLearningAnswer(created.session.id, {
      answer: "银行之间有共同资产持仓的数据可以支持这个判断。",
      clientRequestId: "answer-evidence-round-4",
    });
    expect(feynmanPhase.session.phase).toBe("FEYNMAN");

    const completed = await submitFeynmanExplanation(created.session.id, {
      explanation:
        "系统性风险是局部冲击通过关联、杠杆和流动性扩散为整体风险。例如一家大机构被迫卖资产会导致价格下跌，所以其他机构也受损。如果换到供应链场景，也要看节点之间是否高度关联。",
      clientRequestId: "feynman-1",
    });
    expect(completed.payload.session.phase).toBe("COMPLETED");
    if (!completed.report) throw new Error("Expected completed report");
    expect(completed.report.overallScore).toBeGreaterThan(0);
    expect(completed.report.strengths.length).toBeGreaterThan(0);
    for (const strength of completed.report.strengths) {
      expect(strength.evidence).toContain("学生在本次对话中写道");
    }
    const persistedStrengths = await prisma.learningStrength.findMany({ where: { reportId: completed.report.id }, orderBy: { position: "asc" } });
    expect(persistedStrengths.map(({ title, evidence }) => ({ title, evidence }))).toEqual(completed.report.strengths);


    const retry = await createRetrySession(created.session.id, {
      clientRequestId: "retry-0001",
    });
    expect(retry.session.parentSessionId).toBe(created.session.id);
    expect(retry.session.phase).toBe("DIAGNOSIS");
    expect(retry.duplicate).toBe(false);

    const duplicateRetry = await createRetrySession(created.session.id, {
      clientRequestId: "retry-0001",
    });
    expect(duplicateRetry.duplicate).toBe(true);
    expect(duplicateRetry.session.id).toBe(retry.session.id);
    expect(
      await prisma.learningSession.count({
        where: { parentSessionId: created.session.id },
      }),
    ).toBe(1);
  });

  it("escalates consecutive hints without counting failed or duplicate requests as learning evidence", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "100");
    const user = await createTestUser("hint-escalation");
    const created = await createLearningSession(user.id, { ...task, topic: "汇率风险" });
    const before = await prisma.learningSession.findUniqueOrThrow({ where: { id: created.session.id } });
    const coach = vi.spyOn(MockAIProvider.prototype, "createCoachTurn");
    const first = await requestHint(created.session.id, { clientRequestId: "hint-escalation-1" });
    expect((await requestHint(created.session.id, { clientRequestId: "hint-escalation-1" })).duplicate).toBe(true);
    coach.mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "timeout", 503, true));
    await expect(requestHint(created.session.id, { clientRequestId: "hint-escalation-failed" })).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    const second = await requestHint(created.session.id, { clientRequestId: "hint-escalation-2" });
    const third = await requestHint(created.session.id, { clientRequestId: "hint-escalation-3" });
    await requestHint(created.session.id, { clientRequestId: "hint-escalation-4" });
    expect(coach.mock.calls.map(([input]) => input.unknownStreak)).toEqual([1, 2, 2, 3, 3]);
    expect(new Set([first, second, third].map((result) => result.messages.at(-1)?.content)).size).toBe(3);
    const after = await prisma.learningSession.findUniqueOrThrow({ where: { id: created.session.id } });
    expect(after.phase).toBe(before.phase);
    expect(after.socraticTurns).toBe(before.socraticTurns);
    expect(after.learnerState).toEqual(before.learnerState);
    await submitLearningAnswer(created.session.id, { answer: "本币升值", clientRequestId: "hint-reset-answer" });
    await requestHint(created.session.id, { clientRequestId: "hint-reset-next" });
    expect(coach.mock.calls.at(-1)?.[0].unknownStreak).toBe(1);
    await submitLearningAnswer(created.session.id, { answer: "不知道", clientRequestId: "hint-after-unknown-answer" });
    await requestHint(created.session.id, { clientRequestId: "hint-after-automatic-support" });
    expect(coach.mock.calls.at(-1)?.[0].unknownStreak).toBe(2);
  });

  it("keeps answers and follow-up questions in causal order even when existing messages are ahead of the clock", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const user = await createTestUser("message-causal-order");
    const created = await createLearningSession(user.id, { ...task, topic: "汇率风险" });
    const ahead = new Date(Date.now() + 60_000);
    await prisma.message.update({ where: { id: created.messages[0].id }, data: { createdAt: ahead } });
    const answered = await submitLearningAnswer(created.session.id, { answer: "本币升值会降低外币应收的折算价值。", clientRequestId: "message-order-answer" });
    expect(answered.messages.map((message) => message.role)).toEqual(["ASSISTANT", "USER", "ASSISTANT"]);
    const timestamps = answered.messages.map((message) => new Date(message.createdAt).getTime());
    expect(timestamps[1]).toBeGreaterThan(ahead.getTime());
    expect(timestamps[2]).toBeGreaterThan(timestamps[1]);
    const hinted = await requestHint(created.session.id, { clientRequestId: "message-order-hint" });
    expect(hinted.messages.at(-1)?.questionType).toBe("SCAFFOLDED_HINT");
    expect(new Date(hinted.messages.at(-1)!.createdAt).getTime()).toBeGreaterThan(timestamps[2]);
  });

  it("requires an actual answer to the evidence question before entering Feynman", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const user = await createTestUser("readiness-unanswered");
    const created = await createLearningSession(user.id, { ...task, topic: "汇率风险" });
    await submitLearningAnswer(created.session.id, { answer: "外币现金流的折算价值随汇率变化。", clientRequestId: "readiness-diagnosis" });
    for (let round = 1; round <= 3; round++) {
      await submitLearningAnswer(created.session.id, { answer: `企业有外币应收时，本币升值会降低折算价值，这是第${round}次机制解释。`, clientRequestId: `readiness-round-${round}` });
    }
    const beforeTie = await getSessionPayload(created.session.id);
    // Existing sessions may have identical millisecond timestamps. Their default
    // CUID creation order must still pair each answer with its preceding question.
    await prisma.message.updateMany({ where: { sessionId: created.session.id }, data: { createdAt: new Date() } });
    const waiting = await getSessionPayload(created.session.id);
    expect(waiting.messages.map((message) => message.id)).toEqual(beforeTie.messages.map((message) => message.id));
    expect(waiting.messages.at(-1)?.questionType).toBe("EVIDENCE_PROBE");
    expect(waiting.availableActions?.canEnterFeynman).toBe(false);
    await expect(enterLearningFeynman(created.session.id, { clientRequestId: "readiness-too-early" })).rejects.toMatchObject({ code: "CONFLICT" });
    const answered = await submitLearningAnswer(created.session.id, { answer: "合同约定企业将在月底收取一笔美元货款，这就是外币应收的证据。", clientRequestId: "readiness-evidence-answer" });
    expect(answered.session.phase).toBe("FEYNMAN");
  });

  it("does not count an unknown response or a hint as answered evidence", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const user = await createTestUser("readiness-unknown");
    const created = await createLearningSession(user.id, { ...task, topic: "汇率风险" });
    await submitLearningAnswer(created.session.id, { answer: "外币现金流的折算价值随汇率变化。", clientRequestId: "unknown-diagnosis" });
    for (let round = 1; round <= 3; round++) {
      await submitLearningAnswer(created.session.id, { answer: `企业持有外币资产时，本币升值会降低其折算价值，这是第${round}次解释。`, clientRequestId: `unknown-round-${round}` });
    }
    await requestHint(created.session.id, { clientRequestId: "unknown-evidence-hint" });
    const unknown = await submitLearningAnswer(created.session.id, { answer: "不知道", clientRequestId: "unknown-evidence-answer" });
    expect(unknown.session.socraticTurns).toBe(4);
    expect(unknown.availableActions?.canEnterFeynman).toBe(false);
    await expect(enterLearningFeynman(created.session.id, { clientRequestId: "unknown-enter" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows only one concurrent retry to claim an open gap", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "100");
    const user = await createTestUser("retry-gap-race");
    const keys = ["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"] as const;
    const parent = await prisma.learningSession.create({ data: {
      userId: user.id, topic: "汇率风险", objective: "判断外币头寸", learnerLevel: "入门", phase: "COMPLETED",
      report: { create: { summary: "并发重练测试夹具", overallScore: 60, overallLevel: "发展中", disclaimer: "自动化测试",
        dimensions: { create: keys.map((key) => ({ key, score: 60, evidence: "测试证据", feedback: "继续练习" })) },
        gaps: { create: [{ title: "外币头寸", evidence: "测试中的方向缺口", repairTask: "根据外币头寸解释损益变化", priority: 5 }] },
      } },
    } });
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      return { promise, resolve };
    };
    const diagnosticEntered = deferred();
    const releaseDiagnostic = deferred();
    const secondRetryEntered = deferred();
    const releaseSecondRetry = deferred();
    const diagnosticImpl = MockAIProvider.prototype.createDiagnosticQuestion;
    const retryImpl = MockAIProvider.prototype.createRetryTask;
    vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion").mockImplementation(async (input) => {
      if (input.requestId === "retry-race-a:diagnostic") { diagnosticEntered.resolve(); await releaseDiagnostic.promise; }
      return diagnosticImpl.call(new MockAIProvider(), input);
    });
    vi.spyOn(MockAIProvider.prototype, "createRetryTask").mockImplementation(async (input) => {
      if (input.requestId === "retry-race-b") { secondRetryEntered.resolve(); await releaseSecondRetry.promise; }
      return retryImpl.call(new MockAIProvider(), input);
    });
    const first = createRetrySession(parent.id, { clientRequestId: "retry-race-a" });
    await diagnosticEntered.promise;
    const second = createRetrySession(parent.id, { clientRequestId: "retry-race-b" });
    const secondResult = second.then((result) => ({ result, error: null }), (error: unknown) => ({ result: null, error }));
    await secondRetryEntered.promise;
    releaseDiagnostic.resolve();
    await first;
    releaseSecondRetry.resolve();
    const losing = await secondResult;
    expect(losing.error).toMatchObject({ code: "CONFLICT" });
    expect(losing.result).toBeNull();
    expect(await prisma.learningSession.count({ where: { parentSessionId: parent.id } })).toBe(1);
    expect(await prisma.message.count({ where: { sessionId: parent.id, clientRequestId: { in: ["retry-race-a", "retry-race-b"] } } })).toBe(1);
  });

  it("returns the same session for duplicate creation request ids", async () => {
    const user = await createTestUser("flow-create-idempotent");
    const first = await createLearningSession(user.id, task, { clientRequestId: "create-session-0001" });
    const second = await createLearningSession(user.id, task, { clientRequestId: "create-session-0001" });
    expect(second.session.id).toBe(first.session.id);
    expect(await prisma.learningSession.count({ where: { userId: user.id, clientRequestId: "create-session-0001" } })).toBe(1);
  });

  it("enforces assignment schedule and attempt limits before creating sessions", async () => {
    const user = await createTestUser("flow-assignment-guard");
    const future = await createAssignedTask(user.id, { openAt: new Date(Date.now() + 60_000) });
    await expect(createLearningSession(user.id, { ...task, assignmentId: future.id }, { clientRequestId: "future-assignment" }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const overdue = await createAssignedTask(user.id, { dueAt: new Date(Date.now() - 60_000) });
    await expect(createLearningSession(user.id, { ...task, assignmentId: overdue.id }, { clientRequestId: "overdue-assignment" }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    const usedUp = await createAssignedTask(user.id, { maxAttempts: 1 });
    await prisma.learningSession.create({
      data: {
        userId: user.id,
        assignmentId: usedUp.id,
        source: "ASSIGNMENT",
        topic: "旧任务",
        objective: "已完成",
        learnerLevel: "入门",
        phase: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await expect(createLearningSession(user.id, { ...task, assignmentId: usedUp.id }, { clientRequestId: "used-up-assignment" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("resumes an active assignment session instead of creating a second one", async () => {
    const user = await createTestUser("flow-assignment-resume");
    const assignment = await createAssignedTask(user.id, { maxAttempts: 2 });
    const first = await createLearningSession(user.id, { ...task, assignmentId: assignment.id }, { clientRequestId: "assignment-start-1" });
    const second = await createLearningSession(user.id, { ...task, assignmentId: assignment.id }, { clientRequestId: "assignment-start-2" });
    expect(second.session.id).toBe(first.session.id);
    expect(await prisma.learningSession.count({ where: { userId: user.id, assignmentId: assignment.id } })).toBe(1);
    const progress = await prisma.assignmentStudent.findUniqueOrThrow({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: user.id } },
    });
    expect(progress.progress).toBe("IN_PROGRESS");
    expect(progress.startedAt).toBeInstanceOf(Date);
  });

  it("does not write messages or advance state when the provider fails", async () => {
    const user = await createTestUser("flow-failure");
    const created = await createLearningSession(user.id, task);
    const before = await prisma.learningSession.findUniqueOrThrow({
      where: { id: created.session.id },
      include: { messages: true },
    });
    vi.spyOn(MockAIProvider.prototype, "createCoachTurn").mockRejectedValueOnce(
      new AIProviderError("AI_TIMEOUT", "timeout", 503, true),
    );

    await expect(
      submitLearningAnswer(created.session.id, {
        answer: "这是一次不会被写入数据库的完整回答。",
        clientRequestId: "answer-ai-failure",
      }),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT" });

    const after = await prisma.learningSession.findUniqueOrThrow({
      where: { id: created.session.id },
      include: { messages: true },
    });
    expect(after.phase).toBe(before.phase);
    expect(after.socraticTurns).toBe(before.socraticTurns);
    expect(after.messages).toHaveLength(before.messages.length);
  });

  it("persists curated selection, bounded hints, case transfer and immutable report versions", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "100");
    const user = await createTestUser("curated-flow");
    const created = await createLearningSession(user.id, task);
    const id = created.session.id;
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: "curated-goal" });
    const initial = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const initialRuntime = knowledgeRuntimeSchema.parse(initial.knowledgeRuntime);
    expect(initialRuntime.currentQuestionId).toBe("DQ_SR_001_A");
    await submitLearningAnswer(id, { answer: "我认为单个机构的问题还需要传播条件才会影响整体。", clientRequestId: "curated-diagnosis" });
    const beforeHint = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    await requestHint(id, { clientRequestId: "curated-hint-one" });
    const hinted = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    expect(hinted.learnerState).toEqual(beforeHint.learnerState);
    expect((await requestHint(id, { clientRequestId: "curated-hint-one" })).duplicate).toBe(true);
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).toEqual(hinted.knowledgeRuntime);
    await requestHint(id, { clientRequestId: "curated-hint-two" });
    expect((await getSessionPayload(id)).availableActions?.canRequestHint).toBe(false);
    await expect(requestHint(id, { clientRequestId: "curated-hint-three" })).rejects.toMatchObject({ code: "CONFLICT" });
    const beforeFailure = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    vi.spyOn(MockAIProvider.prototype, "assessLearningTurn").mockRejectedValueOnce(new AIProviderError("AI_TIMEOUT", "timeout", 503, true));
    await expect(submitLearningAnswer(id, { answer: "有共同暴露时抛售可能影响其他机构。", clientRequestId: "curated-failure" })).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).toEqual(beforeFailure.knowledgeRuntime);
    for (let index = 0; index < 20 && (await getSessionPayload(id)).session.phase !== "FEYNMAN"; index += 1) {
      await submitLearningAnswer(id, { answer: `共同资产价格下跌可能增加融资压力，造成进一步的抛售和信贷收缩。这是第${index}次针对当前问题的独立回答。`, clientRequestId: `curated-round-${index}` });
    }
    expect((await getSessionPayload(id)).session.phase).toBe("FEYNMAN");
    const feynman = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const runtime = knowledgeRuntimeSchema.parse(feynman.knowledgeRuntime);
    expect(runtime.pedagogicalStage).toBe("FEYNMAN");
    expect(runtime.v12?.pedagogicalStage).toBe("REFLECTION");
    expect(runtime.v12?.experienceLimitReached).toBe(true);
    expect(runtime.usedCaseIds).toEqual([]);
    expect(new Set(runtime.usedQuestionIds).size).toBe(runtime.usedQuestionIds.length);
    const result = await submitFeynmanExplanation(id, { explanation: "系统性风险涉及金融体系功能受损。共同资产抛售影响价格，价格下跌增加其他机构损失并收缩信贷，进而影响实体经济。", clientRequestId: "curated-feynman" });
    if (!result.report) throw new Error("Expected reflection report");
    expect(result.report.sessionVersions).toEqual(initialRuntime.versions);
    const userMessageIds = result.payload.messages.filter((message) => message.role === "USER").map((message) => message.id);
    for (const messageId of Object.values(result.report.evidenceLinks ?? {}).flat()) expect(userMessageIds).toContain(messageId);
    expect(Object.values(result.report.dimensions).every((dimension) => [0, 25, 50, 75, 100].includes(dimension.score))).toBe(true);
    expect(result.report.dimensions.conceptCompleteness.score).toBeLessThanOrEqual(75);
    const duplicate = await submitFeynmanExplanation(id, { explanation: "这个重复提交不应该改变报告，也不应该改变已经保存的版本快照。", clientRequestId: "curated-feynman" });
    expect(duplicate.report).toEqual(result.report);
    const retry = await createRetrySession(id, { clientRequestId: "curated-retry" });
    const child = await prisma.learningSession.findUniqueOrThrow({ where: { id: retry.session.id } });
    const childRuntime = knowledgeRuntimeSchema.parse(child.knowledgeRuntime);
    expect(childRuntime.currentQuestionId).not.toBe(initialRuntime.currentQuestionId);
    expect(childRuntime.usedCaseIds).toEqual(runtime.usedCaseIds);
    expect(childRuntime.hintLevels).toEqual({});
  });
});
