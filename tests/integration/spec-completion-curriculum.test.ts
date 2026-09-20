import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { POST as createCourseRoute } from "@/app/api/courses/route";
import { POST as createChapterRoute } from "@/app/api/courses/[id]/chapters/route";
import { POST as createGoalRoute } from "@/app/api/chapters/[id]/goals/route";
import { POST as createAssignmentRoute } from "@/app/api/assignments/route";
import { POST as publishAssignmentRoute } from "@/app/api/assignments/[id]/publish/route";
import { POST as createSessionRoute } from "@/app/api/sessions/route";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createTestUser } from "../factories";

const authState = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string; role: "STUDENT" | "TEACHER" | "ADMIN" } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async (roles?: Array<"STUDENT" | "TEACHER" | "ADMIN">) => {
    if (!authState.user) throw new AppError("UNAUTHORIZED", "请登录。", 401);
    if (roles && !roles.includes(authState.user.role)) throw new AppError("FORBIDDEN", "无权操作。", 403);
    return authState.user;
  },
}));

const idEnvelope = z.object({ data: z.object({ id: z.string() }) });
const sessionEnvelope = z.object({ data: z.object({ session: z.object({
  id: z.string(), phase: z.string(), course: z.string(), chapter: z.string().nullable(),
  topic: z.string(), objective: z.string(), learnerLevel: z.string(),
}) }) });
const longCourse = "课".repeat(120);
const longChapter = "章".repeat(120);
const longTitle = "题".repeat(160);
const longObjective = "解释概念边界及证据。".repeat(200);
const longLevel = "阶".repeat(100);

function request(body: unknown) {
  return new Request("http://localhost/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }
async function createdId(response: Response) {
  expect(response.status).toBe(201);
  return idEnvelope.parse(await response.json()).data.id;
}
async function fixture() {
  const teacher = await createTestUser("long-content-owner", "TEACHER");
  const student = await createTestUser("long-content-student");
  authState.user = teacher;
  const courseId = await createdId(await createCourseRoute(request({ title: longCourse, status: "PUBLISHED" })));
  const chapterId = await createdId(await createChapterRoute(request({ title: longChapter, sortOrder: 1 }), context(courseId)));
  const goalId = await createdId(await createGoalRoute(request({ title: longTitle, objective: longObjective, expectedLevel: longLevel, sortOrder: 1 }), context(chapterId)));
  const classroom = await prisma.classroom.create({ data: { courseId, teacherId: teacher.id, name: "长目标班级", joinCode: crypto.randomUUID().slice(0, 8) } });
  await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: student.id } });
  return { teacher, student, courseId, chapterId, goalId, classroomId: classroom.id };
}
async function cleanDb() { await prisma.course.deleteMany(); await prisma.user.deleteMany(); }

describe("teacher curriculum reaches student learning without truncation", () => {
  beforeEach(async () => { process.env.AI_PROVIDER = "mock"; await cleanDb(); });
  afterAll(async () => { await cleanDb(); await prisma.$disconnect(); });

  it("persists maximum-length teacher content through both course and assignment selection", async () => {
    const data = await fixture();
    const assignmentId = await createdId(await createAssignmentRoute(request({
      courseId: data.courseId, classroomId: data.classroomId, chapterId: data.chapterId, learningGoalId: data.goalId,
      title: longTitle, instructions: "按照课程目标解释概念及其适用边界。", learnerLevel: longLevel,
    })));
    expect((await publishAssignmentRoute(request({}), context(assignmentId))).status).toBe(200);
    authState.user = data.student;
    for (const association of [
      { courseId: data.courseId, chapterId: data.chapterId, learningGoalId: data.goalId },
      { assignmentId },
    ]) {
      const response = await createSessionRoute(request({
        ...association, topic: "客户端主题不替代教师内容", objective: "客户端目标不替代教师内容", learnerLevel: longLevel,
        clientRequestId: crypto.randomUUID(),
      }));
      expect(response.status).toBe(201);
      const session = sessionEnvelope.parse(await response.json()).data.session;
      expect(session).toMatchObject({ course: longCourse, chapter: longChapter, topic: longTitle, objective: longObjective, learnerLevel: longLevel, phase: "DIAGNOSIS" });
      expect(await prisma.learningSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({ topic: longTitle, objective: longObjective });
    }
  });

  it("uses all 4000 assignment instruction characters without a separate goal and resumes the same session", async () => {
    const data = await fixture();
    const instructions = "学".repeat(4_000);
    const assignmentId = await createdId(await createAssignmentRoute(request({
      courseId: data.courseId, classroomId: data.classroomId, title: longTitle, instructions, learnerLevel: longLevel,
    })));
    expect((await publishAssignmentRoute(request({}), context(assignmentId))).status).toBe(200);
    authState.user = data.student;
    const start = async () => {
      const response = await createSessionRoute(request({ assignmentId, topic: "教师任务", objective: "教师任务", learnerLevel: "入门", clientRequestId: crypto.randomUUID() }));
      expect(response.status).toBe(201);
      return sessionEnvelope.parse(await response.json()).data.session;
    };
    const first = await start();
    expect(first).toMatchObject({ course: longCourse, topic: longTitle, objective: instructions, learnerLevel: longLevel });
    expect((await start()).id).toBe(first.id);
  });

  it("rejects teacher and student overflow at the API boundary without saving invalid records", async () => {
    const data = await fixture();
    for (const response of [
      await createCourseRoute(request({ title: "课".repeat(121) })),
      await createChapterRoute(request({ title: "章".repeat(121), sortOrder: 1 }), context(data.courseId)),
      await createGoalRoute(request({ title: "题".repeat(161), objective: longObjective, sortOrder: 1 }), context(data.chapterId)),
      await createGoalRoute(request({ title: "新目标", objective: "目".repeat(2_001), sortOrder: 1 }), context(data.chapterId)),
      await createAssignmentRoute(request({ courseId: data.courseId, classroomId: data.classroomId, title: longTitle, instructions: "学".repeat(4_001), learnerLevel: "入门" })),
    ]) expect(response.status).toBe(400);
    expect(await prisma.course.count()).toBe(1);
    expect(await prisma.chapter.count()).toBe(1);
    expect(await prisma.learningGoal.count()).toBe(1);
    expect(await prisma.assignment.count()).toBe(0);
    authState.user = data.student;
    const response = await createSessionRoute(request({ topic: "测试超限", objective: "目".repeat(4_001), learnerLevel: "入门", clientRequestId: crypto.randomUUID() }));
    expect(response.status).toBe(400);
    expect(await prisma.learningSession.count()).toBe(0);
  });

  it("keeps enrollment, teacher ownership and course hierarchy checks for long content", async () => {
    const data = await fixture();
    const stranger = await createTestUser("long-content-stranger");
    authState.user = stranger;
    const input = { courseId: data.courseId, chapterId: data.chapterId, learningGoalId: data.goalId, topic: longTitle, objective: longObjective, learnerLevel: longLevel };
    expect((await createSessionRoute(request({ ...input, clientRequestId: crypto.randomUUID() }))).status).toBe(403);
    expect((await createCourseRoute(request({ title: longCourse }))).status).toBe(403);
    authState.user = await createTestUser("other-long-content-teacher", "TEACHER");
    expect((await createGoalRoute(request({ title: longTitle, objective: longObjective, sortOrder: 1 }), context(data.chapterId))).status).toBe(403);
    const otherChapter = await prisma.chapter.create({ data: { courseId: data.courseId, title: "其他章节", sortOrder: 2 } });
    authState.user = data.student;
    expect((await createSessionRoute(request({ ...input, chapterId: otherChapter.id, clientRequestId: crypto.randomUUID() }))).status).toBe(400);
    expect(await prisma.learningSession.count()).toBe(0);
  });
});
