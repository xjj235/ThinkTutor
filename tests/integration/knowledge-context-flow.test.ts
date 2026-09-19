import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createTestUser } from "../factories";
import { createLearningSession, createRetrySession, submitLearningAnswer, submitFeynmanExplanation, getSessionPayload } from "@/lib/session-service";
import { submitV12SessionEvent } from "@/lib/knowledge/v12-session-service";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { POST as createRoute } from "@/app/api/sessions/route";
import type { AuthUser } from "@/lib/auth/session";

const auth = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => auth.user }));

describe("course goals reach the structured coaching workflow", () => {
  const courseIds: string[] = [];
  beforeEach(() => { courseIds.length = 0; vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"); vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000"); });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  });

  it("resolves both authorized course goals and assignments before knowledge selection", async () => {
    const teacher = await createTestUser("grounded-teacher", "TEACHER");
    const student = await createTestUser("grounded-student"); auth.user = student;
    const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "金融系统与风险", status: "PUBLISHED" } });
    courseIds.push(course.id);
    const chapter = await prisma.chapter.create({ data: { courseId: course.id, title: "系统性风险", sortOrder: 1 } });
    const goal = await prisma.learningGoal.create({ data: { courseId: course.id, chapterId: chapter.id, title: "解释风险传播路径", objective: "能够用条件、传播渠道和系统后果解释系统性风险。", sortOrder: 1 } });
    const classroom = await prisma.classroom.create({ data: { courseId: course.id, teacherId: teacher.id, name: "知识库回归测试班", joinCode: crypto.randomUUID().slice(0, 8) } });
    await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: student.id } });
    const assignment = await prisma.assignment.create({ data: { createdById: teacher.id, classroomId: classroom.id, courseId: course.id, chapterId: chapter.id, learningGoalId: goal.id, title: "风险机制研习", instructions: goal.objective, learnerLevel: "入门", status: "PUBLISHED", students: { create: { studentId: student.id } } } });
    for (const scope of [{ courseId: course.id, chapterId: chapter.id, learningGoalId: goal.id }, { assignmentId: assignment.id }]) {
      const response = await createRoute(new Request("http://localhost/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...scope, topic: "客户端错误主题", objective: "客户端错误目标", learnerLevel: "入门", clientRequestId: crypto.randomUUID() }) }));
      expect(response.status).toBe(201);
      const payload = (await response.json()).data;
      expect(payload.session.topic).toBe(goal.title);
      const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: payload.session.id } });
      expect(knowledgeRuntimeSchema.parse(saved.knowledgeRuntime).versions.releaseId).toBe("KR_SR_1_2");
      await submitV12SessionEvent(saved.id, { action: "GOAL_CONFIRMED", clientRequestId: crypto.randomUUID() });
      const answer = "系统性风险关注金融体系，但我还没有说明它怎样影响其他机构。";
      const request = { answer, clientRequestId: crypto.randomUUID() };
      const assessed = await submitLearningAnswer(saved.id, request);
      expect(assessed.messages.at(-1)?.content).toContain("原文依据");
      expect(assessed.messages.at(-1)?.content).toContain(answer);
      expect(assessed.messages.at(-1)?.content).toContain("下一步至少澄清一项");
      const duplicate = await submitLearningAnswer(saved.id, request);
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.messages).toEqual(assessed.messages);
      expect((await getSessionPayload(saved.id)).messages).toEqual(assessed.messages);
    }
  });

  it("keeps the original subject on retry without rewriting a legacy report", async () => {
    const student = await createTestUser("legacy-subject-retry");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const task = { course: undefined, chapter: undefined, referenceText: undefined, topic: "解释风险传播路径", objective: "说明系统性风险中的条件、机制与后果。", learnerLevel: "入门" };
    let original = await createLearningSession(student.id, task);
    for (let index = 0; index < 6 && original.session.phase !== "FEYNMAN"; index++) original = await submitLearningAnswer(original.session.id, { answer: `我认为关键是观察机构之间的联系，解释条件如何改变行为，再分析行为对其他主体造成的后果。这是第${index}次解释。`, clientRequestId: crypto.randomUUID() });
    expect(original.session.phase).toBe("FEYNMAN");
    const completed = await submitFeynmanExplanation(original.session.id, { explanation: "我认为系统性风险不能只看个别机构，需要观察金融体系中的联系。首先明确事件发生的条件，然后分析机构采取的行动如何影响其他机构，最后说明这些影响是否妨碍了正常的金融服务。例如单家银行经营困难可能影响它的交易对手，但还需要核实影响是否扩大。", clientRequestId: crypto.randomUUID() });
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id: original.session.id } })).knowledgeRuntime).toBeNull();
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    const freeRetry = vi.spyOn(MockAIProvider.prototype, "createRetryTask").mockResolvedValue({ topic: "因果证据核验", objective: "完善条件与结论之间的联系", rationale: "针对原主题的因果链缺口再练。" });
    const teaching = vi.spyOn(MockAIProvider.prototype, "selectTeachingMove");
    const retry = await createRetrySession(original.session.id, { clientRequestId: crypto.randomUUID() });
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: retry.session.id } });
    expect(freeRetry).not.toHaveBeenCalled();
    expect(teaching.mock.calls.at(-1)?.[0].kind).toBe("RETRY");
    expect(retry.session.topic).toBe(task.topic);
    expect(knowledgeRuntimeSchema.parse(saved.knowledgeRuntime).versions.releaseId).toBe("KR_SR_1_2");
    const refreshedReport = (await getSessionPayload(original.session.id)).report;
    if (!completed.report || !refreshedReport) throw new Error("Expected the original completed report");
    expect(completed.report.gaps.every((gap) => gap.status === "OPEN")).toBe(true);
    expect(refreshedReport.gaps.filter((gap) => gap.status === "IN_PROGRESS")).toHaveLength(1);
    expect(refreshedReport.gaps[0].status).toBe("IN_PROGRESS");
    expect(refreshedReport.gaps.slice(1).every((gap) => gap.status === "OPEN")).toBe(true);
    // Retry progress is mutable; every score, evidence field and original report
    // identity remains exactly as it was before starting focused practice.
    expect(refreshedReport.gaps.some((gap) => gap.latestRetry?.sessionId === retry.session.id)).toBe(true);
    const originalGapContents = refreshedReport.gaps.map((gap) => {
      const original = { ...gap, status: "OPEN" as const };
      delete original.latestRetry;
      return original;
    });
    expect({ ...refreshedReport, gaps: originalGapContents }).toEqual(completed.report);
    if (!saved.sourceGapId) throw new Error("Retry must retain the original source gap");
    expect(await prisma.learningGap.findUniqueOrThrow({ where: { id: saved.sourceGapId } })).toMatchObject({ reportId: completed.report.id, status: "IN_PROGRESS" });
    expect((await prisma.learningSession.findUniqueOrThrow({ where: { id: original.session.id } })).knowledgeRuntime).toBeNull();
  });
});
