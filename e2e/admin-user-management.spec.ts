import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-e2e-password-2026";
const prisma = new PrismaClient({ adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 4 }) });

test.afterAll(async () => prisma.$disconnect());

test("admin searches and pages users, confirms dangerous changes, and retries an API failure", async ({ page }) => {
  const marker = crypto.randomUUID().slice(0, 8);
  const passwordHash = await hash(password);
  const admin = await prisma.user.create({ data: { email: `admin-list-${marker}@example.test`, name: "列表管理员", passwordHash, role: "ADMIN" } });
  await prisma.user.createMany({ data: Array.from({ length: 23 }, (_, index) => ({ email: `paged-${marker}-${String(index).padStart(2, "0")}@example.test`, name: `分页用户 ${marker} ${String(index).padStart(2, "0")}`, passwordHash, role: "STUDENT" as const })) });
  const roleTarget = await prisma.user.findFirstOrThrow({ where: { email: `paged-${marker}-00@example.test` } });
  const statusTarget = await prisma.user.findFirstOrThrow({ where: { email: `paged-${marker}-01@example.test` } });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(admin.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.goto(`/admin/users?query=${marker}&role=STUDENT`);
  await expect(page.getByText("第 1 / 2 页")).toBeVisible();
  await page.getByRole("link", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("第 2 / 2 页")).toBeVisible();

  await page.getByLabel("姓名或邮箱").fill(roleTarget.email);
  await page.getByRole("button", { name: "筛选" }).click();
  let roleSelect = page.getByLabel(`${roleTarget.name}的角色`);
  await page.evaluate(() => { window.confirm = () => false; });
  await roleSelect.selectOption("ADMIN");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: roleTarget.id } })).role).toBe("STUDENT");
  await page.reload();
  roleSelect = page.getByLabel(`${roleTarget.name}的角色`);
  await expect(roleSelect).toHaveValue("STUDENT");
  await page.evaluate(() => { window.confirm = () => true; });
  await roleSelect.selectOption("ADMIN");
  await expect(page.getByText("用户设置已更新。")).toBeVisible();
  await expect(roleSelect).toHaveValue("ADMIN");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: roleTarget.id } })).role).toBe("ADMIN");

  await page.goto(`/admin/users?query=${encodeURIComponent(statusTarget.email)}`);
  const statusSelect = page.getByLabel(`${statusTarget.name}的状态`);
  let attempts = 0;
  await page.route(`**/api/admin/users/${statusTarget.id}/status`, async (route) => {
    if (attempts++ === 0) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_ADMIN", message: "模拟管理接口暂时失败", retryable: true } }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => { window.confirm = () => true; });
  await statusSelect.selectOption("DISABLED");
  await expect(page.getByText("模拟管理接口暂时失败")).toBeVisible();
  await expect(statusSelect).toHaveValue("ACTIVE");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("用户设置已更新。")).toBeVisible();
  await expect(statusSelect).toHaveValue("DISABLED");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: statusTarget.id } })).status).toBe("DISABLED");
  expect(await prisma.auditLog.count({ where: { actorId: admin.id, targetId: { in: [roleTarget.id, statusTarget.id] } } })).toBe(2);
});
