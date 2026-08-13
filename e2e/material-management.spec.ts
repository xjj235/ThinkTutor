import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-e2e-password-2026";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 4 }),
});

test.afterAll(async () => prisma.$disconnect());

test("material upload survives transfer and acknowledgement failures, then supports confirmed retryable deletion", async ({ page }) => {
  const marker = crypto.randomUUID();
  const teacher = await prisma.user.create({ data: { email: `material-${marker}@example.test`, name: "材料异常教师", passwordHash: await hash(password), role: "TEACHER" } });
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: `材料课程 ${marker}` } });
  const failed = await prisma.material.create({ data: { courseId: course.id, uploadedById: teacher.id, title: `待重试材料 ${marker}`, originalName: "failed.txt", objectKey: `materials/${marker}-failed.txt`, mimeType: "text/plain", kind: "TXT", byteSize: 6, status: "FAILED", failureCode: "EXTRACT_FAILED", failureMessage: "测试失败" } });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(teacher.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/teacher/);
  await page.goto(`/teacher/courses/${course.id}/materials`);

  let transferAttempts = 0;
  await page.route("**/api/materials/local-upload?**", async (route) => {
    transferAttempts += 1;
    if (transferAttempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_STORAGE", message: "模拟对象存储暂时失败", retryable: true } }) });
      return;
    }
    await route.continue();
  });

  let completeAttempts = 0;
  await page.route("**/api/materials/complete", async (route) => {
    completeAttempts += 1;
    if (completeAttempts === 1) {
      const completed = await route.fetch();
      expect(completed.ok()).toBe(true);
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  const uploadTitle = `异常恢复材料 ${marker}`;
  await page.getByLabel("材料标题").fill(uploadTitle);
  await page.getByLabel(/文件（PDF/).setInputFiles({ name: "recovery.txt", mimeType: "text/plain", buffer: Buffer.from("可恢复的材料内容") });
  await page.getByRole("button", { name: "上传材料" }).click();
  await expect(page.getByText("文件传输失败，请重试。")).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("材料上传失败，请重试。")).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("文件已安全上传并进入处理队列。")).toBeVisible();
  await expect(page.locator(".data-row", { hasText: uploadTitle })).toBeVisible();
  expect(transferAttempts).toBe(2);
  expect(completeAttempts).toBe(2);
  expect(await prisma.material.count({ where: { courseId: course.id, title: uploadTitle } })).toBe(1);

  const failedRow = page.locator(".data-row", { hasText: failed.title });
  let reprocessAttempts = 0;
  await page.route(`**/api/materials/${failed.id}/reprocess`, async (route) => {
    reprocessAttempts += 1;
    if (reprocessAttempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_QUEUE", message: "模拟队列暂时失败", retryable: true } }) });
      return;
    }
    await route.continue();
  });
  await failedRow.getByRole("button", { name: "重试处理" }).click();
  await expect(failedRow.getByText("模拟队列暂时失败")).toBeVisible();
  await failedRow.getByRole("button", { name: "重试", exact: true }).click();
  await expect(failedRow.getByText("已重新加入处理队列。")).toBeVisible();
  await expect.poll(async () => (await prisma.material.findUniqueOrThrow({ where: { id: failed.id }, select: { status: true } })).status).toBe("QUEUED");

  const uploaded = await prisma.material.findFirstOrThrow({ where: { courseId: course.id, title: uploadTitle } });
  const uploadedRow = page.locator(".data-row", { hasText: uploadTitle });
  page.once("dialog", (dialog) => dialog.dismiss());
  await uploadedRow.getByRole("button", { name: "删除材料" }).click();
  await expect(uploadedRow).toBeVisible();

  let deleteAttempts = 0;
  await page.route(`**/api/materials/${uploaded.id}`, async (route) => {
    if (route.request().method() === "DELETE" && deleteAttempts++ === 0) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_DELETE", message: "模拟删除暂时失败", retryable: true } }) });
      return;
    }
    await route.continue();
  });
  page.once("dialog", (dialog) => dialog.accept());
  await uploadedRow.getByRole("button", { name: "删除材料" }).click();
  await expect(uploadedRow.getByText("模拟删除暂时失败")).toBeVisible();
  await uploadedRow.getByRole("button", { name: "重试" }).click();
  await expect.poll(async () => (await prisma.material.findUniqueOrThrow({ where: { id: uploaded.id }, select: { status: true } })).status).toBe("DELETED");
  await expect(uploadedRow).toHaveCount(0);
});
