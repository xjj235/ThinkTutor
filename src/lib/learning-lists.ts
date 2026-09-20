import "server-only";

import type { AssignmentProgress, AssignmentStatus, GapStatus, LearningPhase, SessionSource } from "@prisma/client";
import { prisma } from "./db";
import type { AuthUser } from "./auth/session";
import { requireOwnedClassroom } from "./permissions";
import { AppError } from "./errors";

function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listTeacherAssignments(userId: string, input: { page: number; pageSize: number; query?: string; status?: AssignmentStatus }) {
  const where = { createdById: userId, ...(input.status ? { status: input.status } : {}), ...(input.query ? { OR: [{ title: { contains: input.query, mode: "insensitive" as const } }, { course: { title: { contains: input.query, mode: "insensitive" as const } } }, { classroom: { name: { contains: input.query, mode: "insensitive" as const } } }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.assignment.findMany({ where, select: { id: true, title: true, status: true, updatedAt: true, dueAt: true, classroom: { select: { name: true } }, course: { select: { title: true } }, _count: { select: { students: true, sessions: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.assignment.count({ where }),
  ]);
  return { items, ...pageMeta(total, input.page, input.pageSize) };
}

export async function listAssignmentStudentProgress(user: AuthUser, input: { assignmentId: string; classroomId: string; page: number; pageSize: number; query?: string; progress?: AssignmentProgress }) {
  const assignment = await prisma.assignment.findUnique({ where: { id: input.assignmentId }, select: { classroomId: true } });
  if (!assignment) throw new AppError("NOT_FOUND", "学习任务不存在。", 404);
  await requireOwnedClassroom(user, assignment.classroomId);
  if (assignment.classroomId !== input.classroomId) throw new AppError("VALIDATION_ERROR", "任务与班级不匹配。", 400);
  const where = { assignmentId: input.assignmentId, ...(input.progress ? { progress: input.progress } : {}), ...(input.query ? { student: { OR: [{ name: { contains: input.query, mode: "insensitive" as const } }, { email: { contains: input.query, mode: "insensitive" as const } }] } } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.assignmentStudent.findMany({ where, select: { id: true, studentId: true, progress: true, startedAt: true, completedAt: true, updatedAt: true, student: { select: { name: true, email: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.assignmentStudent.count({ where }),
  ]);
  const sessions = items.length ? await prisma.learningSession.findMany({ where: { assignmentId: input.assignmentId, userId: { in: items.map((item) => item.studentId) } }, select: { id: true, userId: true, phase: true, updatedAt: true, report: { select: { overallScore: true } } }, orderBy: { updatedAt: "desc" } }) : [];
  return { items: items.map((item) => ({ ...item, latestSession: sessions.find((session) => session.userId === item.studentId) ?? null })), ...pageMeta(total, input.page, input.pageSize) };
}

export async function listStudentHistory(userId: string, input: { page: number; pageSize: number; query?: string; phase?: LearningPhase; source?: SessionSource }) {
  const where = { userId, ...(input.phase ? { phase: input.phase } : {}), ...(input.source ? { source: input.source } : {}), ...(input.query ? { OR: [{ topic: { contains: input.query, mode: "insensitive" as const } }, { objective: { contains: input.query, mode: "insensitive" as const } }, { course: { contains: input.query, mode: "insensitive" as const } }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.learningSession.findMany({ where, select: { id: true, topic: true, course: true, objective: true, phase: true, source: true, updatedAt: true, report: { select: { overallScore: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.learningSession.count({ where }),
  ]);
  return { items, ...pageMeta(total, input.page, input.pageSize) };
}

export async function listStudentGaps(userId: string, input: { page: number; pageSize: number; query?: string; status?: GapStatus }) {
  const where = { report: { session: { userId } }, ...(input.status ? { status: input.status } : {}), ...(input.query ? { OR: [{ title: { contains: input.query, mode: "insensitive" as const } }, { evidence: { contains: input.query, mode: "insensitive" as const } }, { repairTask: { contains: input.query, mode: "insensitive" as const } }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.learningGap.findMany({ where, select: { id: true, title: true, evidence: true, repairTask: true, priority: true, status: true, updatedAt: true, report: { select: { sessionId: true, session: { select: { topic: true } } } } }, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.learningGap.count({ where }),
  ]);
  return { items, ...pageMeta(total, input.page, input.pageSize) };
}
