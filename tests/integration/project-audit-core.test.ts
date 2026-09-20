import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import * as requestLimits from "@/lib/request-limits";
import { createLearningSession, enterLearningFeynman, getSessionPayload, requestHint, submitFeynmanExplanation, submitLearningAnswer } from "@/lib/session-service";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { POST as answerRoute } from "@/app/api/sessions/[id]/answers/route";
import type { AuthUser } from "@/lib/auth/session";
import { createTestUser } from "../factories";

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => auth.user }));
const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "条件概率", objective: "解释条件改变时的概率", learnerLevel: "入门" };
const answer = "系统性风险关注金融体系，不是单家银行的损失。还需要核实金融功能受损的影响是否传播。";

async function assignedTask(studentId: string) {
  const teacher = await createTestUser("audit-core-teacher", "TEACHER");
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "概率课程", status: "PUBLISHED" } });
  const classroom = await prisma.classroom.create({ data: { teacherId: teacher.id, courseId: course.id, name: "概率班级", joinCode: crypto.randomUUID().slice(0, 8) } });
  await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: studentId } });
  const assignment = await prisma.assignment.create({ data: {
    courseId: course.id, classroomId: classroom.id, createdById: teacher.id, title: task.topic,
    instructions: task.objective, learnerLevel: task.learnerLevel, status: "PUBLISHED", maxAttempts: 1,
  } });
  await prisma.assignmentStudent.create({ data: { assignmentId: assignment.id, studentId } });
  return assignment;
}

describe("2026-09-20 core learning audit regressions", () => {
  beforeEach(() => { vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("orders a v1.2 answer before its feedback regardless of generated message IDs", async () => {
    const student = await createTestUser("audit-causal-order");
    const id = (await createLearningSession(student.id, { ...task, topic: "系统性风险" })).session.id;
    await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `goal-${id}` });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 1_000));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("ffffffff-ffff-4fff-8fff-ffffffffffff");
    const payload = await submitLearningAnswer(id, { answer, clientRequestId: `answer-${id}` });
    expect(payload.messages.slice(-2).map((message) => message.role)).toEqual(["USER", "ASSISTANT"]);
    const persisted = await getSessionPayload(id);
    expect(persisted.messages.slice(-2).map((message) => message.role)).toEqual(["USER", "ASSISTANT"]);
    expect(Date.parse(persisted.messages.at(-2)!.createdAt)).toBeLessThan(Date.parse(persisted.messages.at(-1)!.createdAt));
  });

  it("creates one active assignment attempt when distinct requests finish AI work together", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const student = await createTestUser("audit-assignment-concurrent");
    const assignment = await assignedTask(student.id);
    // Database correctness must survive multiple workers or an expired AI lease.
    vi.spyOn(requestLimits, "withAIRequestProtection").mockImplementation(async (_user, _key, operation) => operation());
    const original = MockAIProvider.prototype.createDiagnosticQuestion;
    let entered = 0;
    let release!: () => void;
    const bothEntered = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion").mockImplementation(async function (input) {
      if (++entered === 2) release();
      await bothEntered;
      return original.call(new MockAIProvider(), input);
    });
    const sessions = await Promise.all([1, 2].map((index) => createLearningSession(student.id, { ...task, assignmentId: assignment.id }, { clientRequestId: `start-${assignment.id}-${index}` })));
    expect(new Set(sessions.map((session) => session.session.id)).size).toBe(1);
    expect(await prisma.learningSession.count({ where: { userId: student.id, assignmentId: assignment.id } })).toBe(1);
  });

  it("returns the accepted goal confirmation when the same request is concurrently replayed", async () => {
    const student = await createTestUser("audit-event-replay");
    const id = (await createLearningSession(student.id, { ...task, topic: "系统性风险" })).session.id;
    vi.spyOn(requestLimits, "withAIRequestProtection").mockImplementation(async (_user, _key, operation) => operation());
    const original = MockAIProvider.prototype.selectTeachingMove;
    let entered = 0;
    let release!: () => void;
    const bothEntered = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(MockAIProvider.prototype, "selectTeachingMove").mockImplementation(async function (input) {
      if (++entered === 2) release();
      await bothEntered;
      return original.call(new MockAIProvider(), input);
    });
    const results = await Promise.all([1, 2].map(() => submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `replay-${id}` })));
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(await prisma.message.count({ where: { clientRequestId: `replay-${id}` } })).toBe(1);
  });

  it.each([false, true])("rejects stale question revisions before model calls, while preserving replays (v1.2: %s)", async (curated) => {
    const student = await createTestUser("audit-stale-question");
    let payload = await createLearningSession(student.id, { ...task, ...(curated ? { topic: "系统性风险" } : {}) });
    const id = payload.session.id;
    if (curated) payload = await submitV12SessionEvent(id, { action: "GOAL_CONFIRMED", clientRequestId: `goal-${id}`, expectedVersion: payload.session.version });
    const expectedVersion = payload.session.version;
    const accepted = { answer, clientRequestId: `accepted-${id}`, expectedVersion };
    await submitLearningAnswer(id, accepted);
    const before = await getSessionPayload(id);
    const coach = vi.spyOn(MockAIProvider.prototype, "createCoachTurn");
    const assessment = vi.spyOn(MockAIProvider.prototype, "assessLearningTurn");
    await expect(submitLearningAnswer(id, { answer: "这个回答针对旧问题。", clientRequestId: `stale-answer-${id}`, expectedVersion })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    await expect(requestHint(id, { clientRequestId: `stale-hint-${id}`, expectedVersion })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(enterLearningFeynman(id, { clientRequestId: `stale-enter-${id}`, expectedVersion })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitFeynmanExplanation(id, { explanation: "这个讲解来自旧进度。", clientRequestId: `stale-feynman-${id}`, expectedVersion })).rejects.toMatchObject({ code: "CONFLICT" });
    if (curated) await expect(submitV12SessionEvent(id, { action: "SESSION_RESUMED", clientRequestId: `stale-resume-${id}`, expectedVersion })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(coach).not.toHaveBeenCalled();
    expect(assessment).not.toHaveBeenCalled();
    expect(await getSessionPayload(id)).toEqual(before);
    expect((await submitLearningAnswer(id, accepted)).duplicate).toBe(true);
  });

  it.each(["REMOVED", "ARCHIVED"] as const)("rejects an obsolete assignment allocation after membership becomes %s", async (status) => {
    const student = await createTestUser("audit-assignment-membership");
    const assignment = await assignedTask(student.id);
    if (status === "REMOVED") await prisma.enrollment.updateMany({ where: { classroomId: assignment.classroomId, userId: student.id }, data: { status } });
    else await prisma.classroom.update({ where: { id: assignment.classroomId }, data: { status } });
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    await expect(createLearningSession(student.id, { ...task, assignmentId: assignment.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(diagnostic).not.toHaveBeenCalled();
    expect(await prisma.learningSession.count({ where: { assignmentId: assignment.id } })).toBe(0);
  });

  it("returns HTTP 409 for an old browser answer and keeps the accepted question evidence unchanged", async () => {
    const student = await createTestUser("audit-stale-api");
    auth.user = student;
    const initial = await createLearningSession(student.id, task);
    const id = initial.session.id;
    await submitLearningAnswer(id, { answer, clientRequestId: `first-${id}`, expectedVersion: initial.session.version });
    const before = await getSessionPayload(id);
    const response = await answerRoute(new Request(`http://localhost/api/sessions/${id}/answers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "这段回答属于旧问题，不能计入新问题。", clientRequestId: `stale-api-${id}`, expectedVersion: initial.session.version }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(409);
    expect(await getSessionPayload(id)).toEqual(before);
  });

  it("rechecks assignment membership after model work before saving the new attempt", async () => {
    const student = await createTestUser("audit-assignment-revocation");
    const assignment = await assignedTask(student.id);
    const original = MockAIProvider.prototype.createDiagnosticQuestion;
    vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion").mockImplementationOnce(async function (input) {
      await prisma.enrollment.updateMany({ where: { classroomId: assignment.classroomId, userId: student.id }, data: { status: "REMOVED" } });
      return original.call(new MockAIProvider(), input);
    });
    await expect(createLearningSession(student.id, { ...task, assignmentId: assignment.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.learningSession.count({ where: { assignmentId: assignment.id } })).toBe(0);
  });
});
