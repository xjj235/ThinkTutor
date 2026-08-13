import "server-only";

import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { getCurrentUser, type AuthUser } from "./auth/session";

export async function requirePageUser(roles?: readonly UserRole[]): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(user.role === "ADMIN" ? "/admin" : user.role === "TEACHER" ? "/teacher" : "/dashboard");
  return user;
}
