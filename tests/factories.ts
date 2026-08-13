import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";

export async function createTestUser(label: string, role: "STUDENT" | "TEACHER" | "ADMIN" = "STUDENT") {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      email,
      name: `测试用户 ${label}`,
      role,
      passwordHash: await hashPassword("Secure-test-password-2026"),
    },
  });
}
