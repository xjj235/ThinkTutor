import { expect, test } from "@playwright/test";

test("workspace navigation, focus and responsive layout remain usable", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "问思学伴", exact: true })).toBeVisible();
  await expect(page.locator(".public-hero-image")).toBeVisible();
  expect(await page.locator(".public-hero-image").evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("public-entry.png"), fullPage: false });
  await page.getByRole("link", { name: "创建学生账号" }).click();
  await page.getByLabel("姓名").fill("研习界面测试");
  await page.getByLabel("邮箱").fill(`workspace-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Workspace-test-2026!");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "学习总览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "尚无研习记录" })).toBeVisible();
  const header = await page.locator(".workspace-shell").boundingBox();
  const main = await page.locator("main").boundingBox();
  expect(header).not.toBeNull();
  expect(main).not.toBeNull();
  expect(header!.x).toBe(0);
  expect(header!.y).toBe(0);
  expect(main!.y).toBeGreaterThanOrEqual(header!.height);
  expect(Math.abs(main!.x - ((page.viewportSize()?.width ?? 1440) - main!.width) / 2)).toBeLessThan(2);
  await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("workspace-empty.png"), fullPage: true });
  const mobile = (page.viewportSize()?.width ?? 1440) < 960;
  if (mobile) {
    await page.getByRole("button", { name: "打开主导航" }).click();
    await expect(page.getByRole("button", { name: "关闭主导航" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "学习总览" })).toBeFocused();
    const menu = await page.locator(".workspace-navigation").boundingBox();
    const expandedMain = await page.locator("main").boundingBox();
    expect(expandedMain!.y).toBeGreaterThanOrEqual(menu!.y + menu!.height);
    await page.screenshot({ path: testInfo.outputPath("workspace-top-menu.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "打开主导航" })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "主导航", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "打开主导航" }).click();
  }
  const nav = page.getByRole("navigation", { name: "主导航", exact: true });
  await expect(nav.getByRole("link", { name: "学习总览" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "用户管理" })).toHaveCount(0);
  if (!mobile) {
    const items = await nav.getByRole("link").evaluateAll((links) => links.map((link) => ({ x: link.getBoundingClientRect().x, y: link.getBoundingClientRect().y })));
    expect(new Set(items.map((item) => item.y)).size).toBe(1);
    expect(items[1].x).toBeGreaterThan(items[0].x);
  }
  await nav.getByRole("link", { name: "自主研习" }).click();
  await expect(page.getByRole("heading", { name: "创建研习任务" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator("main").evaluate((element) => element instanceof HTMLElement && element.inert)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("create-task.png"), fullPage: true });
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard/);
});
