import { expect, test, type Page } from "@playwright/test";

async function assertSingleEntry(page: Page) {
  const action = page.getByRole("link", { name: "新建学习任务", exact: true });
  await expect(action).toHaveCount(1);
  await expect(action).toBeInViewport();
  await expect(page.locator("main .button")).toHaveCount(1);
  await expect(page.locator(".stat-grid,.study-agenda,.role-ledger,.method-track")).toHaveCount(0);
  const bounds = await action.boundingBox();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - page.viewportSize()!.width / 2)).toBeLessThan(2);
  expect(bounds!.height).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("single home action continues through registration and login to a new task", async ({ page }, info) => {
  const email = `entry-${crypto.randomUUID()}@example.test`;
  const password = "Home-entry-password-2026!";
  await page.goto("/");
  await assertSingleEntry(page);
  await page.screenshot({ path: info.outputPath("public-home.png"), fullPage: true });
  await page.getByRole("link", { name: "新建学习任务", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Flearn%2Fnew$/);
  await expect(page.getByText("登录后，继续新建学习任务。")).toBeVisible();
  await page.getByRole("link", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/register\?next=%2Flearn%2Fnew$/);
  await page.getByLabel("姓名").fill("首页体验学生");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/learn\/new$/);
  await expect(page.getByRole("heading", { name: "创建研习任务" })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await assertSingleEntry(page);
  await page.screenshot({ path: info.outputPath("student-home.png"), fullPage: true });
  await page.getByRole("button", { name: "个人中心", exact: true }).click();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "个人中心", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "新建学习任务", exact: true }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/new$/);

  // Arbitrary next values must never turn the auth flow into an open redirect.
  await page.goto("/login?next=https%3A%2F%2Fexample.org");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/register?next=%2Fadmin");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("home remains calm in dark appearance and keyboard users can start directly", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "切换为深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await assertSingleEntry(page);
  const action = page.getByRole("link", { name: "新建学习任务", exact: true });
  await action.focus();
  await expect(action).toBeFocused();
  await page.screenshot({ path: info.outputPath("home-dark-focused.png"), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login\?next=%2Flearn%2Fnew$/);
});
