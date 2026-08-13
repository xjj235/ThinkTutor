import "server-only";

import type { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";

const userSelect = { id: true, email: true, name: true, role: true, status: true, lastLoginAt: true, createdAt: true } as const;

export async function getAdminOverview() {
  const [users, students, teachers, activeSessions, completedSessions, failedMaterials, failedAI, courses, classrooms] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { role: "STUDENT" } }), prisma.user.count({ where: { role: "TEACHER" } }),
    prisma.learningSession.count({ where: { phase: { in: ["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "REPORTING"] } } }),
    prisma.learningSession.count({ where: { phase: "COMPLETED" } }), prisma.material.count({ where: { status: "FAILED" } }),
    prisma.aIUsage.count({ where: { status: "FAILED" } }), prisma.course.count(), prisma.classroom.count(),
  ]);
  return { users, students, teachers, activeSessions, completedSessions, failedMaterials, failedAI, courses, classrooms };
}

export async function listAdminUsers(input: { cursor?: string; limit: number; query?: string; page?: number; role?: UserRole; status?: UserStatus }) {
  const where = {
    ...(input.query ? { OR: [{ email: { contains: input.query, mode: "insensitive" as const } }, { name: { contains: input.query, mode: "insensitive" as const } }] } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const page = input.page ?? 1;
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
    where,
    select: userSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : { skip: (page - 1) * input.limit }),
  }),
    prisma.user.count({ where }),
  ]);
  return { items: users, total, page, pageSize: input.limit, totalPages: Math.max(1, Math.ceil(total / input.limit)) };
}

export async function changeUserRole(actorId: string, userId: string, role: UserRole, requestId: string) {
  if (actorId === userId && role !== "ADMIN") throw new AppError("CONFLICT", "不能移除自己的管理员身份。", 409);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { role }, select: userSelect });
    await tx.auditLog.create({ data: { actorId, action: "USER_ROLE_CHANGED", targetType: "User", targetId: userId, requestId, metadata: { role } } });
    return user;
  });
}

export async function changeUserStatus(actorId: string, userId: string, status: UserStatus, requestId: string) {
  if (actorId === userId && status !== "ACTIVE") throw new AppError("CONFLICT", "不能停用自己的管理员账号。", 409);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { status, deletedAt: status === "DELETED" ? new Date() : null }, select: userSelect });
    if (status !== "ACTIVE") await tx.authSession.deleteMany({ where: { userId } });
    await tx.auditLog.create({ data: { actorId, action: "USER_STATUS_CHANGED", targetType: "User", targetId: userId, requestId, metadata: { status } } });
    return user;
  });
}

export async function listAIUsage(limit: number) {
  return prisma.aIUsage.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, provider: true, model: true, operation: true, status: true, promptTokens: true, completionTokens: true, cacheHitTokens: true, latencyMs: true, retryCount: true, errorCode: true, createdAt: true } });
}

export async function listMaterialJobs(limit: number) {
  return prisma.material.findMany({ where: { status: { in: ["QUEUED", "PROCESSING", "FAILED", "UNSUPPORTED"] } }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, title: true, originalName: true, status: true, retryCount: true, failureCode: true, failureMessage: true, updatedAt: true } });
}

export async function listAuditLogs(limit: number) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      requestId: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
}
