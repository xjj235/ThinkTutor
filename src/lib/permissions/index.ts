import "server-only";

import type { AuthUser } from "../auth/session";
import { prisma } from "../db";
import { AppError } from "../errors";

export function assertTeacherOrAdmin(user: AuthUser): void {
  if (user.role !== "TEACHER" && user.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "仅教师或管理员可以执行此操作。", 403);
  }
}

export async function requireOwnedCourse(user: AuthUser, courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new AppError("NOT_FOUND", "课程不存在。", 404);
  if (user.role !== "ADMIN" && course.ownerId !== user.id) {
    throw new AppError("FORBIDDEN", "你无权访问该课程。", 403);
  }
  return course;
}

export async function requireOwnedClassroom(user: AuthUser, classroomId: string) {
  const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom) throw new AppError("NOT_FOUND", "班级不存在。", 404);
  if (user.role !== "ADMIN" && classroom.teacherId !== user.id) {
    throw new AppError("FORBIDDEN", "你无权访问该班级。", 403);
  }
  return classroom;
}

export async function requireSessionAccess(user: AuthUser, sessionId: string) {
  const session = await prisma.learningSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, assignment: { select: { createdById: true } } },
  });
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  const allowed = user.role === "ADMIN" || session.userId === user.id || session.assignment?.createdById === user.id;
  if (!allowed) throw new AppError("FORBIDDEN", "你无权访问该学习会话。", 403);
  return session;
}

export async function requireStudentSession(user: AuthUser, sessionId: string): Promise<void> {
  const session = await prisma.learningSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
  if (!session) throw new AppError("NOT_FOUND", "学习会话不存在。", 404);
  if (session.userId !== user.id) throw new AppError("FORBIDDEN", "只能操作自己的学习会话。", 403);
}
