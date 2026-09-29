import { expect, test } from "@playwright/test";

test("student account navigation preserves all secondary routes with keyboard access", async ({ page }, info) => {
  await page.goto("/register");
  await page.getByLabel("姓名").fill("研习界面测试");
  await page.getByLabel("邮箱").fill(`workspace-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Workspace-test-2026!");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "今天，想弄懂什么？" })).toBeVisible();
  const header = await page.locator(".workspace-shell").boundingBox();
  const main = await page.locator("main").boundingBox();
  expect(header!.x).toBe(0);
  expect(header!.y).toBe(0);
  expect(main!.y).toBeGreaterThanOrEqual(header!.height);
  await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "个人中心", exact: true })).toBeHidden();

  const toggle = page.getByRole("button", { name: "个人中心", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const navigation = page.getByRole("navigation", { name: "个人中心", exact: true });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "学习首页" })).toBeFocused();
  await expect(navigation.getByRole("link", { name: "学习首页" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "用户管理" })).toHaveCount(0);
  for (const [label, route] of [["历史学习记录", "/history"], ["学习分析", "/profile/learning"], ["课程任务", "/assignments"], ["学习班级", "/classes"], ["个人资料与账号安全", "/profile"]]) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", route);
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.screenshot({ path: info.outputPath("student-account-menu.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toBeHidden();

  await toggle.click();
  await navigation.getByRole("link", { name: "历史学习记录", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { name: "尚无研习档案" })).toBeVisible();
  await expect(navigation).toBeHidden();
  await toggle.click();
  await navigation.getByRole("link", { name: "个人资料与账号安全", exact: true }).click();
  const learning = page.getByRole("navigation", { name: "我的学习", exact: true });
  await expect(learning.getByRole("link", { name: "历史学习记录" })).toHaveAttribute("href", "/history");
  await expect(learning.getByRole("link", { name: "学习分析" })).toHaveAttribute("href", "/profile/learning");
  await page.screenshot({ path: info.outputPath("student-profile.png"), fullPage: true });
  await learning.getByRole("link", { name: "课程任务" }).click();
  await expect(page).toHaveURL(/\/assignments$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "新建学习任务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "创建研习任务" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
