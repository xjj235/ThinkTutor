import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UserRole } from "@prisma/client";
import { hash } from "argon2";

const password = "Knowledge-library-test-2026!";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true }) });
const documentPath = "/teacher/knowledge/library/exchange-rate-risk-01";

async function loginAs(page: Page, role: UserRole) {
  const user = await prisma.user.create({ data: { email: `library-${crypto.randomUUID()}@example.test`, name: "资料库测试员", role, passwordHash: await hash(password) } });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(user.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(role === "ADMIN" ? /\/admin$/ : role === "TEACHER" ? /\/teacher$/ : /\/dashboard$/);
}

test.afterAll(async () => prisma.$disconnect());

test("teachers browse all forty references, search full text, and inspect sources", async ({ page }, testInfo) => {
  await loginAs(page, "TEACHER");
  await page.goto("/teacher/knowledge");
  await page.getByRole("link", { name: "知识资料库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "知识资料库", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("找到 40 份文档。");
  await expect(page.locator('a[href^="/teacher/knowledge/library/"]')).toHaveCount(40);
  await expect(page.getByText("资料待教师审核", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("风险主题").selectOption("exchange-rate-risk");
  await page.getByRole("button", { name: "搜索资料", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("找到 8 份文档。");
  await page.getByLabel("全文搜索").fill("Canonical Knowledge");
  await page.getByRole("button", { name: "搜索资料", exact: true }).click();
  await page.locator(`a[href^="${documentPath}"]`).click();
  await expect(page.getByRole("heading", { name: "完整原文", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "原文命中位置", exact: true })).toBeVisible();
  await expect(page.locator('article[id="paragraph:2"]')).toContainText("Canonical Knowledge Specification");
  await page.getByText("来源与校验信息", { exact: true }).click();
  await expect(page.getByText("汇率风险_8个文档_v1.2.1.zip", { exact: true })).toBeVisible();
  await expect(page.getByText("9c9955ccba1e29fa75a2595eb92bc70010da3d7f5af20d13d165b3bb558e6001", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("knowledge-library-document.png"), fullPage: false });
  await page.getByRole("link", { name: "返回资料库", exact: true }).click();
  await page.getByLabel("全文搜索").fill("不存在的参考资料关键词XYZ");
  await page.getByRole("button", { name: "搜索资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "没有找到匹配资料", exact: true })).toBeVisible();
});

test("library pages protect teacher material from unauthenticated users and students", async ({ page }) => {
  for (const path of ["/teacher/knowledge/library", documentPath]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "完整原文", exact: true })).toHaveCount(0);
  }
  await loginAs(page, "STUDENT");
  for (const path of ["/teacher/knowledge/library", documentPath]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "完整原文", exact: true })).toHaveCount(0);
  }
});

test("administrators can inspect imported reference documents", async ({ page }) => {
  await loginAs(page, "ADMIN");
  await page.goto(documentPath);
  await expect(page.getByRole("heading", { name: "完整原文", exact: true })).toBeVisible();
  await page.goto("/teacher/knowledge/library/not-a-document");
  await expect(page.getByRole("heading", { name: "未找到该页面", exact: true })).toBeVisible();
});
