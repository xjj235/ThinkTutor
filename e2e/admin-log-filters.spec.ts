import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const prisma = new PrismaClient({ adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 4 }) });
test.afterAll(async () => prisma.$disconnect());

test("administrators filter and page AI, audit and material records without exposing them to students", async ({ page }) => {
  const marker = crypto.randomUUID().slice(0, 8);
  const password = "Admin-list-check-2026!";
  const passwordHash = await hash(password);
  const admin = await prisma.user.create({ data: { email: `logs-${marker}@example.test`, name: "记录管理员", role: "ADMIN", passwordHash } });
  const student = await prisma.user.create({ data: { email: `student-${marker}@example.test`, name: "记录隔离学生", role: "STUDENT", passwordHash } });
  const course = await prisma.course.create({ data: { ownerId: admin.id, title: "管理记录课程" } });
  const createdAt = new Date("2035-01-01T04:00:00Z");
  await prisma.aIUsage.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ provider: "deepseek", model: `model-${marker}`, operation: "coach", requestId: `${marker}-${index}`, status: "FAILED", latencyMs: 10, createdAt })) });
  await prisma.auditLog.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ actorId: admin.id, action: "COURSE_UPDATED", targetType: "Course", targetId: course.id, requestId: `${marker}-${index}`, createdAt })) });
  await prisma.material.createMany({ data: Array.from({ length: 21 }, (_, index) => ({ courseId: course.id, uploadedById: admin.id, title: `材料-${marker}-${index}`, originalName: "lesson.txt", objectKey: `${marker}/${index}`, mimeType: "text/plain", kind: "TXT", byteSize: 1, status: "FAILED", updatedAt: createdAt })) });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(admin.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const lists = [
    { path: "/admin/ai", label: "模型、提供方、错误码或请求 ID", field: "status", value: "FAILED", empty: "没有匹配的 AI 使用记录" },
    { path: "/admin/audit", label: "操作者、目标 ID 或请求 ID", field: "action", value: "COURSE_UPDATED", empty: "没有匹配的审计事件" },
    { path: "/admin/materials", label: "材料标题或文件名", field: "status", value: "FAILED", empty: "没有匹配的材料任务" },
  ];
  for (const item of lists) {
    await page.goto(item.path);
    await page.getByLabel(item.label).fill(marker);
    await page.locator(`select[name="${item.field}"]`).selectOption(item.value);
    await page.getByLabel("开始日期（北京时间）").fill("2035-01-01");
    await page.getByLabel("结束日期（北京时间）").fill("2035-01-01");
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByText("第 1 / 2 页", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "下一页" }).click();
    await expect(page.getByText("第 2 / 2 页", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("query")).toBe(marker);
    expect(new URL(page.url()).searchParams.get("from")).toBe("2035-01-01");
    expect(new URL(page.url()).searchParams.get(item.field)).toBe(item.value);
    await page.getByLabel(item.label).fill(`missing-${marker}`);
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    await expect(page.getByRole("heading", { name: item.empty })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    await page.goto(`${item.path}?from=2035-01-02&to=2035-01-01`);
    await expect(page.getByRole("alert").filter({ hasText: "筛选条件无效" })).toBeVisible();
  }
  await page.request.post("/api/auth/logout", { data: {} });
  expect((await page.request.post("/api/auth/login", { data: { email: student.email, password } })).ok()).toBe(true);
  for (const item of lists) {
    await page.goto(item.path);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(`model-${marker}`, { exact: true })).toHaveCount(0);
  }
});
