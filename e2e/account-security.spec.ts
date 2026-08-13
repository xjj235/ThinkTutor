import { expect, test } from "@playwright/test";

const currentPassword = "Secure-account-password-2026";
const newPassword = "Secure-account-new-2026";

test("a user manages password and account deletion entirely through HTML pages", async ({ page }) => {
  const email = `account-${crypto.randomUUID()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("姓名").fill("账号安全测试");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(currentPassword);
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "个人资料与账号安全" })).toBeVisible();
  await page.getByLabel("当前密码", { exact: true }).first().fill(currentPassword);
  await page.getByLabel("新密码").fill(newPassword);
  await page.getByRole("button", { name: "修改密码并重新登录" }).click();
  await expect(page).toHaveURL(/\/login\?passwordChanged=true/);

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(newPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/profile");
  await page.getByLabel("输入“删除我的账号”确认").fill("删除我的账号");
  await page.getByLabel("当前密码", { exact: true }).last().fill(newPassword);
  await page.getByRole("button", { name: "永久删除账号" }).click();
  await expect(page).toHaveURL(/accountDeleted=true/);
  await expect(page.getByRole("heading", { name: /从“好像懂了”\s*到真正讲清楚/ })).toBeVisible();

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(newPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("邮箱或密码不正确。", { exact: true })).toBeVisible();
});
