import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { prisma } from "../db";
import { getServerEnv } from "../env";
import { AppError } from "../errors";

export const authCookieName = "tt_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAuthSession(userId: string): Promise<void> {
  const env = getServerEnv();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1_000);

  await prisma.authSession.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(authCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production" || env.AUTH_COOKIE_SECURE,
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteCurrentAuthSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(authCookieName)?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
  cookieStore.delete(authCookieName);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(authCookieName)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true, status: true } },
    },
  });

  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    if (session) await prisma.authSession.deleteMany({ where: { id: session.id } });
    return null;
  }

  return session.user;
}

export async function requireUser(roles?: readonly UserRole[]): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHORIZED", "请先登录。", 401);
  if (roles && !roles.includes(user.role)) throw new AppError("FORBIDDEN", "你没有执行此操作的权限。", 403);
  return user;
}
