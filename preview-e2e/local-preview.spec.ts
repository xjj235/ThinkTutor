import { expect, test, type Page } from "@playwright/test";

const password = process.env.PREVIEW_PASSWORD ?? "ThinkTutor-Preview-2026!";

async function assertFitsViewport(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function captureNormalPage(page: Page, path: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path, fullPage: true });
}

async function login(page: Page, email: string, role?: "学生" | "教师" | "管理员"): Promise<void> {
  if (role) {
    await page.goto("/");
    await page.getByText("本地演示账号", { exact: true }).click();
    await page.getByRole("link", { name: new RegExp(`^${role}`) }).click();
    await expect(page.getByLabel("邮箱")).toHaveValue(email);
    await expect(page.getByLabel("密码")).toHaveValue(password);
  } else {
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
  }
  await page.getByRole("button", { name: "登录" }).click();
}

async function logout(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "个人中心", exact: true });
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true") await menu.click();
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("local preview serves HTML and exposes the production-compatible result entry and all three roles", async ({ page, request }, testInfo) => {
  const documentResponse = await request.get("/");
  expect(documentResponse.status()).toBe(200);
  expect(documentResponse.headers()["content-type"]).toContain("text/html");

  await page.goto("/");
  await expect(page).toHaveTitle("问思学伴 ThinkTutor");
  await expect(page.getByRole("heading", { name: "问思学伴", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "新建学习任务", exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "本地预览工具" })).toBeVisible();
  await expect(page.getByText("student@example.test")).toBeHidden();
  await assertFitsViewport(page);
  await captureNormalPage(page, `.local-preview/home-${testInfo.project.name}.png`);
  await page.getByText("本地演示账号", { exact: true }).click();
  await expect(page.getByText("student@example.test")).toBeVisible();
  await expect(page.getByText("teacher@example.test")).toBeVisible();
  await expect(page.getByText("admin@example.test")).toBeVisible();
  await assertFitsViewport(page);

  await login(page, "student@example.test", "学生");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "今天，想弄懂什么？" })).toBeVisible();
  await captureNormalPage(page, `.local-preview/student-dashboard-${testInfo.project.name}.png`);
  await page.getByRole("button", { name: "个人中心", exact: true }).click();
  await page.getByRole("link", { name: "历史学习记录", exact: true }).click();
  await page.getByRole("link", { name: /解释风险传播路径/ }).click();
  await expect(page.getByRole("heading", { name: "解释风险传播路径" })).toBeVisible();
  await assertFitsViewport(page);
  await captureNormalPage(page, `.local-preview/learning-session-${testInfo.project.name}.png`);
  await page.goto("/assignments");
  await expect(page.getByText("系统性风险形成机制")).toBeVisible();
  await assertFitsViewport(page);
  await logout(page);

  await login(page, "teacher@example.test", "教师");
  await expect(page).toHaveURL(/\/teacher/);
  await expect(page.getByRole("heading", { name: "教师工作台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理课程" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理班级" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理任务" })).toBeVisible();
  await assertFitsViewport(page);
  await captureNormalPage(page, `.local-preview/teacher-dashboard-${testInfo.project.name}.png`);
  await logout(page);

  await login(page, "admin@example.test", "管理员");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "系统管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "用户管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "AI 使用" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看审计日志" })).toBeVisible();
  await assertFitsViewport(page);
  await captureNormalPage(page, `.local-preview/admin-dashboard-${testInfo.project.name}.png`);
});
