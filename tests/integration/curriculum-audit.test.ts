import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as patchAssignmentRoute, GET as getAssignmentRoute } from "@/app/api/assignments/[id]/route";
import { POST as joinClassroomRoute } from "@/app/api/classes/[id]/join/route";
import { GET as getClassAnalyticsRoute } from "@/app/api/teacher/classes/[id]/analytics/route";
import { getClassroom, getCourse, joinClassroom, leaveClassroom, listCourses, publishAssignment, updateAssignment } from "@/lib/courses-service";
import type { AuthUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { listAssignmentStudentProgress } from "@/lib/learning-lists";
import { createTestUser } from "../factories";

const authState = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async (roles?: AuthUser["role"][]) => {
    if (!authState.user) throw new AppError("UNAUTHORIZED", "请登录。", 401);
    if (roles && !roles.includes(authState.user.role)) throw new AppError("FORBIDDEN", "无权操作。", 403);
    return authState.user;
  },
}));

function request(body: unknown, method = "PATCH") {
  return new Request("http://localhost/api/test", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }
async function cleanup() { await prisma.course.deleteMany(); await prisma.user.deleteMany(); }
async function fixture(label: string) {
  const teacher = await createTestUser(`${label}-teacher`, "TEACHER");
  const student = await createTestUser(`${label}-student`);
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "论证课程", status: "PUBLISHED" } });
  const chapter = await prisma.chapter.create({ data: { courseId: course.id, title: "证据与推理", sortOrder: 1 } });
  const goal = await prisma.learningGoal.create({ data: { courseId: course.id, chapterId: chapter.id, title: "建立证据链", objective: "解释证据如何支持主张及其适用条件。", sortOrder: 1 } });
  const classroom = await prisma.classroom.create({ data: { courseId: course.id, teacherId: teacher.id, name: "论证学习班", joinCode: crypto.randomUUID().slice(0, 8) } });
  const assignment = await prisma.assignment.create({ data: { courseId: course.id, classroomId: classroom.id, chapterId: chapter.id, learningGoalId: goal.id, createdById: teacher.id, title: "判断证据", instructions: "请用自己的话说明证据如何支持结论。", learnerLevel: "入门", openAt: new Date("2030-01-01"), dueAt: new Date("2030-02-01") } });
  authState.user = teacher;
  return { teacher, student, course, chapter, goal, classroom, assignment };
}

describe("curriculum authorization and records audit regressions", () => {
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await prisma.$disconnect(); });

  it("rejects moving a draft into a different teacher's classroom", async () => {
    const own = await fixture("own");
    const foreign = await fixture("foreign");
    authState.user = own.teacher;
    const response = await patchAssignmentRoute(request({ classroomId: foreign.classroom.id }), context(own.assignment.id));
    expect(response.status).toBe(403);
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: own.assignment.id } })).toMatchObject({ classroomId: own.classroom.id, version: 1 });
  });

  it("validates patched course, chapter and goal against the final assignment hierarchy", async () => {
    const own = await fixture("hierarchy");
    const foreign = await fixture("foreign-hierarchy");
    const sibling = await prisma.chapter.create({ data: { courseId: own.course.id, title: "另一章节", sortOrder: 2 } });
    authState.user = own.teacher;
    for (const patch of [{ courseId: foreign.course.id }, { chapterId: foreign.chapter.id }, { learningGoalId: foreign.goal.id }, { chapterId: sibling.id }]) {
      expect((await patchAssignmentRoute(request(patch), context(own.assignment.id))).status).toBe(400);
    }
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: own.assignment.id } })).toMatchObject({ courseId: own.course.id, chapterId: own.chapter.id, learningGoalId: own.goal.id, version: 1 });
  });

  it("checks partial schedule edits against saved dates and preserves valid patch behavior", async () => {
    const data = await fixture("dates");
    for (const patch of [{ openAt: "2030-03-01" }, { dueAt: "2029-12-01" }]) {
      expect((await patchAssignmentRoute(request(patch), context(data.assignment.id))).status).toBe(400);
    }
    expect((await patchAssignmentRoute(request({ title: "修改后的任务", dueAt: "2030-03-01" }), context(data.assignment.id))).status).toBe(200);
    expect(await prisma.assignment.findUniqueOrThrow({ where: { id: data.assignment.id } })).toMatchObject({ title: "修改后的任务", version: 2, dueAt: new Date("2030-03-01") });
    await publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID());
    expect((await patchAssignmentRoute(request({ title: "不应静默修改" }), context(data.assignment.id))).status).toBe(409);
  });

  it("assigns published tasks on late classroom join without resetting previous progress", async () => {
    const data = await fixture("late-join");
    await publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID());
    await prisma.assignment.create({ data: { courseId: data.course.id, classroomId: data.classroom.id, createdById: data.teacher.id, title: "暂不公开", instructions: "草稿学习要求内容不会分配给学生。", learnerLevel: "入门" } });
    authState.user = data.student;
    expect((await joinClassroomRoute(request({ joinCode: data.classroom.joinCode }, "POST"), context(data.classroom.id))).status).toBe(200);
    const where = { assignmentId_studentId: { assignmentId: data.assignment.id, studentId: data.student.id } };
    expect(await prisma.assignmentStudent.findUnique({ where })).toMatchObject({ progress: "NOT_STARTED" });
    await prisma.assignmentStudent.update({ where, data: { progress: "COMPLETED", completedAt: new Date() } });
    await leaveClassroom(data.student, data.classroom.id, crypto.randomUUID());
    await joinClassroom(data.student, data.classroom.id, data.classroom.joinCode, crypto.randomUUID());
    expect(await prisma.assignmentStudent.findUnique({ where })).toMatchObject({ progress: "COMPLETED" });
    expect(await prisma.assignmentStudent.count({ where: { studentId: data.student.id } })).toBe(1);
  });

  it("does not lose assignment delivery when joining and publishing overlap", async () => {
    const data = await fixture("concurrent-join");
    await Promise.all([
      publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID()),
      joinClassroom(data.student, data.classroom.id, data.classroom.joinCode, crypto.randomUUID()),
    ]);
    expect(await prisma.assignmentStudent.count({ where: { assignmentId: data.assignment.id, studentId: data.student.id } })).toBe(1);
  });

  it("publishes a draft once when requests overlap and rejects later edits", async () => {
    const data = await fixture("double-publish");
    const results = await Promise.allSettled([
      publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID()),
      publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await prisma.auditLog.count({ where: { targetId: data.assignment.id, action: "ASSIGNMENT_PUBLISHED" } })).toBe(1);
    await expect(updateAssignment(data.teacher, data.assignment.id, { title: "不能覆盖发布内容" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("removes archived classrooms from student course access and task reads", async () => {
    const data = await fixture("archive");
    await joinClassroom(data.student, data.classroom.id, data.classroom.joinCode, crypto.randomUUID());
    await publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID());
    expect((await listCourses(data.student)).map((course) => course.id)).toContain(data.course.id);
    await prisma.classroom.update({ where: { id: data.classroom.id }, data: { status: "ARCHIVED" } });
    expect(await listCourses(data.student)).toEqual([]);
    expect((await getClassroom(data.student, data.classroom.id)).assignments).toEqual([]);
    await expect(getCourse(data.student, data.course.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    authState.user = data.student;
    expect((await getAssignmentRoute(new Request("http://localhost/api/test"), context(data.assignment.id))).status).toBe(403);
    expect(await getCourse(data.teacher, data.course.id)).toMatchObject({ id: data.course.id });
  });

  it("revokes current assignment access after leaving while retaining progress records", async () => {
    const data = await fixture("leave");
    await joinClassroom(data.student, data.classroom.id, data.classroom.joinCode, crypto.randomUUID());
    await publishAssignment(data.teacher, data.assignment.id, crypto.randomUUID());
    authState.user = data.student;
    expect((await getAssignmentRoute(new Request("http://localhost/api/test"), context(data.assignment.id))).status).toBe(200);
    await leaveClassroom(data.student, data.classroom.id, crypto.randomUUID());
    expect((await getAssignmentRoute(new Request("http://localhost/api/test"), context(data.assignment.id))).status).toBe(403);
    expect(await prisma.assignmentStudent.count({ where: { assignmentId: data.assignment.id, studentId: data.student.id } })).toBe(1);
  });

  it("binds teacher progress access to the actual assignment classroom", async () => {
    const own = await fixture("progress-owner");
    const foreign = await fixture("progress-foreign");
    await prisma.assignmentStudent.create({ data: { assignmentId: foreign.assignment.id, studentId: foreign.student.id } });
    await expect(listAssignmentStudentProgress(own.teacher, { assignmentId: foreign.assignment.id, classroomId: own.classroom.id, page: 1, pageSize: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("counts each assigned learner's latest completed report once in class averages", async () => {
    const data = await fixture("class-average");
    const peer = await createTestUser("class-average-peer");
    await prisma.assignmentStudent.createMany({ data: [data.student.id, peer.id].map((studentId) => ({ assignmentId: data.assignment.id, studentId, progress: "COMPLETED" as const })) });
    const records = [
      { userId: data.student.id, score: 20, completedAt: new Date("2030-01-01") },
      { userId: data.student.id, score: 80, completedAt: new Date("2030-01-02") },
      { userId: peer.id, score: 60, completedAt: new Date("2030-01-01") },
    ];
    for (const record of records) {
      await prisma.learningSession.create({ data: { userId: record.userId, assignmentId: data.assignment.id, topic: "证据判断", objective: "建立可复核的推理证据链", learnerLevel: "入门", phase: "COMPLETED", completedAt: record.completedAt, report: { create: { summary: "合成回归报告", overallScore: record.score, overallLevel: "发展中", disclaimer: "仅测试夹具" } } } });
    }
    const response = await getClassAnalyticsRoute(new Request("http://localhost/api/test"), context(data.classroom.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { assignments: [{ assignedCount: 2, completedCount: 2, averageScore: 70 }] } });
  });
});
