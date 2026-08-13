import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { logger, safeErrorForLog } from "../logger";
import { hashPassword, verifyPassword } from "./password";
import type { LoginInput, RegisterInput } from "./schemas";
import { createAuthSession, deleteCurrentAuthSession } from "./session";

const publicUserSelect = { id: true, email: true, name: true, role: true, status: true, createdAt: true } as const;

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function recordFailedLogin(input: LoginInput, targetId: string | null, requestId: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: "AUTH_LOGIN_FAILED",
        targetType: "User",
        targetId,
        requestId,
        metadata: { emailHash: emailHash(input.email) },
      },
    });
  } catch (error) {
    logger.warn({ requestId, ...safeErrorForLog(error) }, "failed to persist rejected login audit event");
  }
}

export async function registerStudent(input: RegisterInput, requestId: string) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash, role: "STUDENT" },
        select: publicUserSelect,
      });
      await tx.auditLog.create({
        data: { actorId: created.id, action: "USER_REGISTERED", targetType: "User", targetId: created.id, requestId },
      });
      return created;
    });
    await createAuthSession(user.id);
    return user;
  } catch (error) {
    if (isUniqueError(error)) throw new AppError("CONFLICT", "该邮箱已经注册。", 409);
    throw error;
  }
}

export async function loginUser(input: LoginInput, requestId: string) {
  const record = await prisma.user.findUnique({ where: { email: input.email } });
  if (!record || record.status !== "ACTIVE" || !(await verifyPassword(record.passwordHash, input.password))) {
    await recordFailedLogin(input, record?.id ?? null, requestId);
    throw new AppError("UNAUTHORIZED", "邮箱或密码不正确。", 401);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.id }, data: { lastLoginAt: new Date() } });
    await tx.auditLog.create({
      data: { actorId: record.id, action: "AUTH_LOGIN", targetType: "User", targetId: record.id, requestId },
    });
  });
  await createAuthSession(record.id);
  return { id: record.id, email: record.email, name: record.name, role: record.role, status: record.status };
}

export async function logoutUser(userId: string, requestId: string): Promise<void> {
  await prisma.auditLog.create({
    data: { actorId: userId, action: "AUTH_LOGOUT", targetType: "User", targetId: userId, requestId },
  });
  await deleteCurrentAuthSession();
}

export async function updateUserProfile(userId: string, name: string) {
  return prisma.user.update({ where: { id: userId }, data: { name }, select: publicUserSelect });
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string, requestId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError("UNAUTHORIZED", "当前密码不正确。", 401);
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.authSession.deleteMany({ where: { userId } }),
    prisma.auditLog.create({
      data: { actorId: userId, action: "USER_PASSWORD_CHANGED", targetType: "User", targetId: userId, requestId },
    }),
  ]);
  await deleteCurrentAuthSession();
}

export async function deleteUserAccount(userId: string, password: string, requestId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      passwordHash: true,
      role: true,
      _count: { select: { ownedCourses: true, createdClassrooms: true, createdAssignments: true } },
    },
  });
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new AppError("UNAUTHORIZED", "密码不正确。", 401);
  }
  if (user.role === "ADMIN") {
    throw new AppError("CONFLICT", "管理员账号不能通过个人资料页删除。", 409);
  }
  if (user.role === "TEACHER") {
    if (user._count.ownedCourses + user._count.createdClassrooms + user._count.createdAssignments > 0) {
      throw new AppError("CONFLICT", "请先转移或删除你负责的课程、班级和作业，再删除账号。", 409);
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: { actorId: userId, action: "USER_DELETED", targetType: "User", targetId: userId, requestId },
    });
    await tx.user.delete({ where: { id: userId } });
  });
  (await cookiesForDeletion()).delete("tt_session");
}

async function cookiesForDeletion() {
  const { cookies } = await import("next/headers");
  return cookies();
}
