import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-curriculum-audit-2026";
const prisma = new PrismaClient({ adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 3 }) });

test.afterAll(async () => prisma.$disconnect());

test("late join receives existing tasks and HTML withdrawal preserves the student's history", async ({ page, request }) => {
  const suffix = crypto.randomUUID();
  const passwordHash = await hash(password);
  const teacher = await prisma.user.create({ data: { email: `access-teacher-${suffix}@example.test`, name: "课程访问教师", role: "TEACHER", passwordHash } });
  const student = await prisma.user.create({ data: { email: `access-student-${suffix}@example.test`, name: "课程访问学生", role: "STUDENT", passwordHash } });
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "可复核证据课程", status: "PUBLISHED" } });
  const classroom = await prisma.classroom.create({ data: { courseId: course.id, teacherId: teacher.id, name: "晚加入学习班", joinCode: suffix.slice(0, 8) } });
  const assignment = await prisma.assignment.create({ data: { courseId: course.id, classroomId: classroom.id, createdById: teacher.id, title: "可复核证据学习", instructions: "说明如何用可复核的证据支持一项主张，并解释推理边界。", learnerLevel: "入门" } });
  expect((await request.post("/api/auth/login", { data: { email: teacher.email, password } })).ok()).toBe(true);
  expect((await request.post(`/api/assignments/${assignment.id}/publish`, { data: {} })).ok()).toBe(true);
  expect(await prisma.assignmentStudent.count({ where: { assignmentId: assignment.id } })).toBe(0);

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(student.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/classes");
  await page.getByLabel("班级 ID").fill(classroom.id);
  await page.getByLabel("加入码").fill(classroom.joinCode);
  await page.getByRole("button", { name: "加入班级", exact: true }).click();
  await expect(page).toHaveURL(`/classes/${classroom.id}`);
  await page.getByRole("link", { name: /可复核证据学习/ }).click();
  await expect(page.getByRole("button", { name: "开始这项学习", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始这项学习", exact: true }).click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionId = page.url().split("/").at(-1)!;

  await page.goto(`/classes/${classroom.id}`);
  await page.getByRole("button", { name: "退出班级", exact: true }).click();
  await expect(page.getByText(/已有学习记录和报告会保留/)).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出班级", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出班级", exact: true }).click();
  await page.getByRole("button", { name: "确认退出班级", exact: true }).click();
  await expect(page).toHaveURL("/classes");
  await page.goto("/assignments");
  await expect(page.getByRole("link", { name: /可复核证据学习/ })).toHaveCount(0);
  expect((await page.request.get(`/api/assignments/${assignment.id}`)).status()).toBe(403);
  await page.goto("/history");
  await expect(page.locator(`a[href="/session/${sessionId}"]`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(`a[href="/session/${sessionId}"]`).click();
  await page.getByLabel("独立作答").fill("主张需要可核验的证据支持，并说明证据到结论的推理条件。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByLabel("独立作答")).toHaveValue("");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});
