import "server-only";

import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { AuthUser } from "./auth/session";
import { prisma } from "./db";
import type { assignmentInputSchema, assignmentPatchSchema, courseInputSchema, goalInputSchema } from "./domain-schemas";
import { AppError } from "./errors";
import { assertTeacherOrAdmin, requireOwnedClassroom, requireOwnedCourse } from "./permissions";

const courseSelect = {
  id: true,
  title: true,
  description: true,
  subject: true,
  audience: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  chapters: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      title: true,
      description: true,
      sortOrder: true,
      goals: {
        orderBy: { sortOrder: "asc" as const },
        select: { id: true, title: true, objective: true, expectedLevel: true, sortOrder: true },
      },
    },
  },
  _count: { select: { classrooms: true, materials: true, assignments: true } },
} satisfies Prisma.CourseSelect;

export async function listCourses(user: AuthUser) {
  if (user.role === "ADMIN") return prisma.course.findMany({ select: courseSelect, orderBy: { updatedAt: "desc" } });
  if (user.role === "TEACHER") {
    return prisma.course.findMany({ where: { ownerId: user.id }, select: courseSelect, orderBy: { updatedAt: "desc" } });
  }
  return prisma.course.findMany({
    where: { status: "PUBLISHED", classrooms: { some: { status: "ACTIVE", enrollments: { some: { userId: user.id, status: "ACTIVE" } } } } },
    select: courseSelect,
    orderBy: { updatedAt: "desc" },
  });
}

export async function createCourse(user: AuthUser, data: z.infer<typeof courseInputSchema>, requestId: string) {
  assertTeacherOrAdmin(user);
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.create({ data: { ...data, ownerId: user.id }, select: courseSelect });
    await tx.auditLog.create({ data: { actorId: user.id, action: "COURSE_CREATED", targetType: "Course", targetId: course.id, requestId } });
    return course;
  });
}

export async function getCourse(user: AuthUser, courseId: string) {
  const accessRecord = await prisma.course.findUnique({ where: { id: courseId }, select: { ownerId: true, status: true } });
  if (!accessRecord) throw new AppError("NOT_FOUND", "课程不存在。", 404);
  if (accessRecord.ownerId !== user.id && user.role !== "ADMIN") {
    const enrolled = await prisma.enrollment.findFirst({ where: { userId: user.id, status: "ACTIVE", classroom: { courseId, status: "ACTIVE" } } });
    if (!enrolled || accessRecord.status !== "PUBLISHED") throw new AppError("FORBIDDEN", "你无权访问该课程。", 403);
  }
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: courseSelect });
  if (!course) throw new AppError("NOT_FOUND", "课程不存在。", 404);
  return course;
}

export async function updateCourse(user: AuthUser, courseId: string, data: Prisma.CourseUpdateInput, requestId: string) {
  await requireOwnedCourse(user, courseId);
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.update({ where: { id: courseId }, data, select: courseSelect });
    await tx.auditLog.create({ data: { actorId: user.id, action: "COURSE_UPDATED", targetType: "Course", targetId: courseId, requestId } });
    return course;
  });
}

export async function createChapter(user: AuthUser, courseId: string, data: Prisma.ChapterUncheckedCreateWithoutCourseInput) {
  await requireOwnedCourse(user, courseId);
  return prisma.chapter.create({ data: { ...data, courseId } });
}

export async function updateChapter(user: AuthUser, chapterId: string, data: Prisma.ChapterUpdateInput) {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) throw new AppError("NOT_FOUND", "章节不存在。", 404);
  await requireOwnedCourse(user, chapter.courseId);
  return prisma.chapter.update({ where: { id: chapterId }, data });
}

export async function deleteChapter(user: AuthUser, chapterId: string): Promise<void> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) throw new AppError("NOT_FOUND", "章节不存在。", 404);
  await requireOwnedCourse(user, chapter.courseId);
  await prisma.chapter.delete({ where: { id: chapterId } });
}

export async function createGoal(user: AuthUser, chapterId: string, data: z.infer<typeof goalInputSchema>) {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (!chapter) throw new AppError("NOT_FOUND", "章节不存在。", 404);
  await requireOwnedCourse(user, chapter.courseId);
  return prisma.learningGoal.create({ data: { ...data, chapterId, courseId: chapter.courseId } });
}

export async function updateGoal(user: AuthUser, goalId: string, data: Prisma.LearningGoalUpdateInput) {
  const goal = await prisma.learningGoal.findUnique({ where: { id: goalId } });
  if (!goal) throw new AppError("NOT_FOUND", "学习目标不存在。", 404);
  await requireOwnedCourse(user, goal.courseId);
  return prisma.learningGoal.update({ where: { id: goalId }, data });
}

function joinCode(): string {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "A").slice(0, 8).toUpperCase();
}

export async function createClassroom(user: AuthUser, input: { courseId: string; name: string; description?: string }, requestId: string) {
  await requireOwnedCourse(user, input.courseId);
  return prisma.$transaction(async (tx) => {
    const classroom = await tx.classroom.create({ data: { ...input, teacherId: user.id, joinCode: joinCode() } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "CLASSROOM_CREATED", targetType: "Classroom", targetId: classroom.id, requestId } });
    return classroom;
  });
}

export async function getClassroom(user: AuthUser, classroomId: string) {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      joinEnabled: true,
      joinCode: true,
      teacherId: true,
      course: { select: { id: true, title: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        select: { id: true, userId: true, user: { select: { id: true, name: true, email: true } } },
      },
      assignments: {
        select: { id: true, title: true, description: true, status: true, dueAt: true },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!classroom) throw new AppError("NOT_FOUND", "班级不存在。", 404);
  const canManage = user.role === "ADMIN" || classroom.teacherId === user.id;
  if (canManage) {
    return {
      id: classroom.id,
      name: classroom.name,
      description: classroom.description,
      status: classroom.status,
      joinEnabled: classroom.joinEnabled,
      joinCode: classroom.joinCode,
      course: classroom.course,
      enrollments: classroom.enrollments.map(({ id, user: member }) => ({ id, user: member })),
      assignments: classroom.assignments,
    };
  }
  const membership = classroom.enrollments.some((enrollment) => enrollment.userId === user.id);
  if (!membership) throw new AppError("FORBIDDEN", "你无权访问该班级。", 403);
  return {
    id: classroom.id,
    name: classroom.name,
    description: classroom.description,
    status: classroom.status,
    joinEnabled: false,
    joinCode: null,
    course: classroom.course,
    enrollments: [],
    assignments: classroom.status === "ACTIVE" ? classroom.assignments.filter((assignment) => assignment.status === "PUBLISHED") : [],
  };
}

export async function joinClassroom(user: AuthUser, classroomId: string, code: string, requestId: string) {
  return prisma.$transaction(async (tx) => {
    // Share the classroom lock with publication so neither transaction misses a new member or task.
    await tx.$queryRaw`SELECT id FROM "Classroom" WHERE id = ${classroomId} FOR UPDATE`;
    const classroom = await tx.classroom.findUnique({ where: { id: classroomId } });
    if (!classroom || classroom.joinCode !== code) throw new AppError("NOT_FOUND", "班级或加入码不正确。", 404);
    if (classroom.status !== "ACTIVE" || !classroom.joinEnabled) throw new AppError("CONFLICT", "该班级当前不接受加入。", 409);
    const enrollment = await tx.enrollment.upsert({
      where: { classroomId_userId: { classroomId, userId: user.id } },
      create: { classroomId, userId: user.id },
      update: { status: "ACTIVE" },
    });
    const assignments = await tx.assignment.findMany({ where: { classroomId, status: "PUBLISHED" }, select: { id: true } });
    if (assignments.length) {
      await tx.assignmentStudent.createMany({ data: assignments.map(({ id }) => ({ assignmentId: id, studentId: user.id })), skipDuplicates: true });
    }
    await tx.auditLog.create({ data: { actorId: user.id, action: "ENROLLMENT_CHANGED", targetType: "Classroom", targetId: classroomId, requestId, metadata: { status: "ACTIVE" } } });
    return { classroomId: enrollment.classroomId, status: enrollment.status, joinedAt: enrollment.joinedAt };
  });
}

export async function leaveClassroom(user: AuthUser, classroomId: string, requestId: string) {
  await prisma.$transaction(async (tx) => {
    const result = await tx.enrollment.updateMany({ where: { classroomId, userId: user.id }, data: { status: "REMOVED" } });
    if (result.count === 0) throw new AppError("NOT_FOUND", "未找到班级成员关系。", 404);
    await tx.auditLog.create({ data: { actorId: user.id, action: "ENROLLMENT_CHANGED", targetType: "Classroom", targetId: classroomId, requestId, metadata: { status: "REMOVED" } } });
  });
}

async function validateAssignmentHierarchy(user: AuthUser, input: Pick<z.infer<typeof assignmentInputSchema>, "classroomId" | "courseId" | "chapterId" | "learningGoalId">) {
  const classroom = await requireOwnedClassroom(user, input.classroomId);
  if (classroom.courseId !== input.courseId) throw new AppError("VALIDATION_ERROR", "班级与课程不匹配。", 400);
  if (input.chapterId) {
    const chapter = await prisma.chapter.findFirst({ where: { id: input.chapterId, courseId: input.courseId }, select: { id: true } });
    if (!chapter) throw new AppError("VALIDATION_ERROR", "所选章节不属于该课程。", 400);
  }
  if (input.learningGoalId) {
    const goal = await prisma.learningGoal.findFirst({
      where: { id: input.learningGoalId, courseId: input.courseId },
      select: { id: true, chapterId: true },
    });
    if (!goal) throw new AppError("VALIDATION_ERROR", "所选学习目标不属于该课程。", 400);
    if (input.chapterId && goal.chapterId !== input.chapterId) throw new AppError("VALIDATION_ERROR", "所选学习目标不属于该章节。", 400);
  }
}

export async function createAssignment(user: AuthUser, input: z.infer<typeof assignmentInputSchema>) {
  await validateAssignmentHierarchy(user, input);
  return prisma.assignment.create({ data: { ...input, createdById: user.id, status: "DRAFT" } });
}

export async function updateAssignment(user: AuthUser, assignmentId: string, data: z.infer<typeof assignmentPatchSchema>) {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw new AppError("NOT_FOUND", "学习任务不存在。", 404);
  await requireOwnedClassroom(user, assignment.classroomId);
  if (assignment.status !== "DRAFT") throw new AppError("CONFLICT", "已发布任务的核心内容不能静默修改。", 409);
  await validateAssignmentHierarchy(user, {
    classroomId: data.classroomId ?? assignment.classroomId,
    courseId: data.courseId ?? assignment.courseId,
    chapterId: data.chapterId ?? assignment.chapterId ?? undefined,
    learningGoalId: data.learningGoalId ?? assignment.learningGoalId ?? undefined,
  });
  const openAt = data.openAt ?? assignment.openAt;
  const dueAt = data.dueAt ?? assignment.dueAt;
  if (openAt && dueAt && openAt >= dueAt) throw new AppError("VALIDATION_ERROR", "截止时间必须晚于开放时间。", 400);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assignment.updateMany({ where: { id: assignmentId, status: "DRAFT", version: assignment.version }, data: { ...data, version: { increment: 1 } } });
    if (updated.count !== 1) throw new AppError("CONFLICT", "任务已被更新或发布，请刷新后重试。", 409, true);
    return tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  });
}

export async function publishAssignment(user: AuthUser, assignmentId: string, requestId: string) {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw new AppError("NOT_FOUND", "学习任务不存在。", 404);
  await requireOwnedClassroom(user, assignment.classroomId);
  if (assignment.status !== "DRAFT") throw new AppError("CONFLICT", "只有草稿任务可以发布。", 409);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Classroom" WHERE id = ${assignment.classroomId} FOR UPDATE`;
    const updated = await tx.assignment.updateMany({ where: { id: assignmentId, status: "DRAFT", version: assignment.version }, data: { status: "PUBLISHED", publishedAt: new Date(), version: { increment: 1 } } });
    if (updated.count !== 1) throw new AppError("CONFLICT", "任务已被更新或发布，请刷新后重试。", 409, true);
    const published = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    const enrollments = await tx.enrollment.findMany({ where: { classroomId: assignment.classroomId, status: "ACTIVE" }, select: { userId: true } });
    if (enrollments.length) {
      await tx.assignmentStudent.createMany({ data: enrollments.map(({ userId }) => ({ assignmentId, studentId: userId })), skipDuplicates: true });
    }
    await tx.auditLog.create({ data: { actorId: user.id, action: "ASSIGNMENT_PUBLISHED", targetType: "Assignment", targetId: assignmentId, requestId } });
    return published;
  });
}

export async function getAssignment(user: AuthUser, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId }, include: { classroom: true, course: true, chapter: true, learningGoal: true } });
  if (!assignment) throw new AppError("NOT_FOUND", "学习任务不存在。", 404);
  if (user.role !== "ADMIN" && assignment.createdById !== user.id) {
    const progress = await prisma.assignmentStudent.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId: user.id } }, select: { id: true } });
    const enrolled = await prisma.enrollment.findFirst({ where: { classroomId: assignment.classroomId, userId: user.id, status: "ACTIVE" }, select: { id: true } });
    if (!progress || !enrolled || assignment.status !== "PUBLISHED" || assignment.classroom.status !== "ACTIVE") throw new AppError("FORBIDDEN", "你无权访问该学习任务。", 403);
  }
  return {
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    instructions: assignment.instructions,
    learnerLevel: assignment.learnerLevel,
    status: assignment.status,
    openAt: assignment.openAt,
    dueAt: assignment.dueAt,
    maxAttempts: assignment.maxAttempts,
    course: { id: assignment.course.id, title: assignment.course.title },
    classroom: { id: assignment.classroom.id, name: assignment.classroom.name },
    chapter: assignment.chapter ? { id: assignment.chapter.id, title: assignment.chapter.title } : null,
    learningGoal: assignment.learningGoal
      ? { id: assignment.learningGoal.id, title: assignment.learningGoal.title, objective: assignment.learningGoal.objective }
      : null,
  };
}
