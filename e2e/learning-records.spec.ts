import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-e2e-password-2026";
const prisma = new PrismaClient({ adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 4 }) });

test.afterAll(async () => prisma.$disconnect());

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("student history and profile provide filtering, pagination, persistent URLs, and empty states", async ({ page }) => {
  const marker = crypto.randomUUID().slice(0, 8);
  const student = await prisma.user.create({ data: { email: `records-${marker}@example.test`, name: "档案学生", passwordHash: await hash(password), role: "STUDENT" } });
  const sessions = await Promise.all(Array.from({ length: 22 }, (_, index) => prisma.learningSession.create({ data: { userId: student.id, topic: `分页知识点 ${marker} ${String(index).padStart(2, "0")}`, objective: "验证学习历史筛选与分页", learnerLevel: "入门", phase: index % 2 ? "SOCRATIC" : "DIAGNOSIS", source: index % 3 ? "SELF_DIRECTED" : "RETRY" } })));
  const report = await prisma.learningReport.create({ data: { sessionId: sessions[0].id, summary: "仅用于测试真实数据库页面记录", overallScore: 60, overallLevel: "发展中", disclaimer: "形成性学习反馈" } });
  await prisma.learningGap.createMany({ data: [
    { reportId: report.id, title: `开放漏洞 ${marker}`, evidence: "本次解释缺少边界", repairTask: "补充一个反例", priority: 5, status: "OPEN" },
    { reportId: report.id, title: `已解决漏洞 ${marker}`, evidence: "后续回答已补充", repairTask: "继续迁移", priority: 2, status: "RESOLVED", resolvedAt: new Date() },
  ] });

  await login(page, student.email);
  await page.goto("/history");
  await expect(page.getByText("第 1 / 2 页")).toBeVisible();
  await page.getByRole("link", { name: "下一页" }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.getByLabel("搜索").fill(`${marker} 00`);
  await page.getByLabel("阶段").selectOption("DIAGNOSIS");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page).toHaveURL(/phase=DIAGNOSIS/);
  await expect(page.getByText(new RegExp(`分页知识点 ${marker} 00`))).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("阶段")).toHaveValue("DIAGNOSIS");
  await page.getByLabel("搜索").fill("肯定不存在的历史记录");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page.getByRole("heading", { name: "没有匹配记录" })).toBeVisible();

  await page.goto("/profile/learning");
  await expect(page.getByText(`开放漏洞 ${marker}`)).toBeVisible();
  await expect(page.getByText(`已解决漏洞 ${marker}`)).toHaveCount(0);
  await page.getByLabel("状态").selectOption("ALL");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page.getByText(`已解决漏洞 ${marker}`)).toBeVisible();
  await page.getByLabel("搜索").fill("肯定不存在的漏洞");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page.getByRole("heading", { name: "没有匹配要点" })).toBeVisible();

  const emptyStudent = await prisma.user.create({ data: { email: `records-empty-${marker}@example.test`, name: "空档案学生", passwordHash: await hash(password), role: "STUDENT" } });
  await page.request.post("/api/auth/logout", { data: {} });
  await login(page, emptyStudent.email);
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "尚无研习档案" })).toBeVisible();
  await page.goto("/profile/learning");
  await expect(page.getByRole("heading", { name: "暂无待巩固要点" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
