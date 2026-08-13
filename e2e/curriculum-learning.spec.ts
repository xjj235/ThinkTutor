import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-curriculum-password-2026";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 3 }),
});

test.afterAll(async () => prisma.$disconnect());

test("a student selects an authorized course goal in HTML and forged curriculum ids are rejected", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const [teacher, student] = await Promise.all([
    prisma.user.create({ data: { email: `curriculum-teacher-${suffix}@example.test`, name: "课程教师", role: "TEACHER", passwordHash: await hash(password) } }),
    prisma.user.create({ data: { email: `curriculum-student-${suffix}@example.test`, name: "课程学生", role: "STUDENT", passwordHash: await hash(password) } }),
  ]);
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "金融风险课程", status: "PUBLISHED" } });
  const chapter = await prisma.chapter.create({ data: { courseId: course.id, title: "系统性风险章节", sortOrder: 1 } });
  const goal = await prisma.learningGoal.create({ data: { courseId: course.id, chapterId: chapter.id, title: "解释风险传播", objective: "能够解释风险通过机构关联扩散的条件、渠道与后果。", sortOrder: 1 } });
  const classroom = await prisma.classroom.create({ data: { courseId: course.id, teacherId: teacher.id, name: "课程目标测试班", joinCode: `C${suffix.replaceAll("-", "").slice(0, 7)}` } });
  await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: student.id } });
  const forbiddenCourse = await prisma.course.create({ data: { ownerId: teacher.id, title: "未授权课程", status: "PUBLISHED" } });
  const forbiddenChapter = await prisma.chapter.create({ data: { courseId: forbiddenCourse.id, title: "未授权章节", sortOrder: 1 } });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(student.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const forbidden = await page.request.post("/api/sessions", { data: { courseId: forbiddenCourse.id, topic: "越权主题", objective: "这个请求不应读取未授权课程材料。", learnerLevel: "入门" } });
  expect(forbidden.status()).toBe(403);
  const mixedHierarchy = await page.request.post("/api/sessions", { data: { courseId: course.id, chapterId: forbiddenChapter.id, topic: "错误层级", objective: "这个请求不应混用其他课程的章节。", learnerLevel: "入门" } });
  expect(mixedHierarchy.status()).toBe(400);

  await page.goto("/learn/new");
  await expect(page).toHaveURL(/\/learn\/new/);
  await expect(page.getByRole("heading", { name: "开始自主学习" })).toBeVisible();
  await page.locator("#curriculum-course").selectOption(course.id);
  await page.locator("#curriculum-chapter").selectOption(chapter.id);
  await page.locator("#curriculum-goal").selectOption(goal.id);
  await expect(page.getByLabel("课程（可选）")).toHaveValue(course.title);
  await expect(page.getByLabel("章节（可选）")).toHaveValue(chapter.title);
  await expect(page.getByLabel("知识点")).toHaveValue(goal.title);
  await expect(page.locator("#objective")).toHaveValue(goal.objective);
  await page.getByLabel("学习者水平").selectOption("入门");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.getByText(course.title)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
