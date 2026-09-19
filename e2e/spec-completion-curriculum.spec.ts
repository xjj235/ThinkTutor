import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-long-curriculum-password-2026";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 3 }),
});
const courseTitle = "Course".repeat(20);
const chapterTitle = "Lesson".repeat(20);
const goalTitle = "Goal".repeat(40);
const objective = "Evidence".repeat(250);
const instructions = "Explain.".repeat(500);
const learnerLevel = "L".repeat(100);

async function login(page: Page, email: string, role: "teacher" | "student") {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(role === "teacher" ? /\/teacher/ : /\/dashboard/);
}
async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.afterAll(async () => prisma.$disconnect());

test("teacher HTML accepts full content and students start both long goals and long assignments intact", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = crypto.randomUUID();
  const passwordHash = await hash(password);
  const teacher = await prisma.user.create({ data: { email: `long-teacher-${suffix}@example.test`, name: "长目标教师", role: "TEACHER", passwordHash } });
  const student = await prisma.user.create({ data: { email: `long-student-${suffix}@example.test`, name: "长目标学生", role: "STUDENT", passwordHash } });
  await login(page, teacher.email, "teacher");
  await page.goto("/teacher/courses/new");
  await expect(page.getByLabel("课程名称")).toHaveAttribute("maxlength", "120");
  await page.getByLabel("课程名称").fill(courseTitle);
  await page.getByRole("button", { name: "创建课程", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher\/courses\/(?!new)[^/]+$/);
  const courseId = page.url().split("/").at(-1)!;
  await page.getByRole("link", { name: "章节与目标" }).click();
  await expect(page.getByLabel("章节名称")).toHaveAttribute("maxlength", "120");
  await page.getByLabel("章节名称").fill(chapterTitle);
  await page.getByRole("button", { name: "添加章节", exact: true }).click();
  await expect(page.getByText("章节已创建。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("目标标题")).toHaveAttribute("maxlength", "160");
  await expect(page.getByLabel("可验证目标")).toHaveAttribute("maxlength", "2000");
  await page.getByLabel("目标标题").fill(goalTitle);
  await page.getByLabel("可验证目标").fill(objective);
  await page.getByLabel("预期水平").fill(learnerLevel);
  await page.getByRole("button", { name: "添加目标", exact: true }).click();
  await expect(page.getByText("目标已创建。", { exact: true })).toBeVisible();
  await expect(page.getByText(objective, { exact: true })).toBeVisible();
  await fitsViewport(page);

  const chapter = await prisma.chapter.findFirstOrThrow({ where: { courseId } });
  const goal = await prisma.learningGoal.findFirstOrThrow({ where: { chapterId: chapter.id } });
  expect(goal.objective).toBe(objective);
  expect((await page.request.patch(`/api/courses/${courseId}`, { data: { status: "PUBLISHED" } })).status()).toBe(200);
  const classroom = await prisma.classroom.create({ data: { courseId, teacherId: teacher.id, name: "长目标学习班", joinCode: suffix.slice(0, 8) } });
  await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: student.id } });

  await page.goto("/teacher/assignments/new");
  await page.getByRole("combobox", { name: /^班级/ }).selectOption(classroom.id);
  await page.getByLabel("任务名称").fill(goalTitle);
  await page.getByLabel("学习要求").fill(instructions);
  await page.getByLabel("学习者水平").fill(learnerLevel);
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher\/assignments\/(?!new)[^/]+$/);
  const assignmentId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "发布给班级", exact: true }).click();
  await expect(page.getByRole("button", { name: "已发布", exact: true })).toBeVisible();
  await fitsViewport(page);

  await page.context().clearCookies();
  await login(page, student.email, "student");
  await page.goto("/learn/new");
  await page.locator("#curriculum-course").selectOption(courseId);
  await page.locator("#curriculum-chapter").selectOption(chapter.id);
  await page.locator("#curriculum-goal").selectOption(goal.id);
  await expect(page.getByLabel("课程（可选）")).toHaveValue(courseTitle);
  await expect(page.getByLabel("知识点")).toHaveValue(goalTitle);
  await expect(page.locator("#objective")).toHaveValue(objective);
  await expect(page.locator("#objective")).toHaveAttribute("maxlength", "4000");
  await page.getByLabel("学习者水平").selectOption("入门");
  await fitsViewport(page);
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  const goalSessionId = page.url().split("/").at(-1)!;
  expect(await prisma.learningSession.findUniqueOrThrow({ where: { id: goalSessionId } })).toMatchObject({ course: courseTitle, chapter: chapterTitle, topic: goalTitle, objective });
  await expect(page.locator(".learning-title p")).toHaveText(objective);
  await fitsViewport(page);

  await page.goto(`/assignments/${assignmentId}`);
  await fitsViewport(page);
  await page.getByRole("button", { name: "开始这项学习", exact: true }).click();
  await expect(page).toHaveURL(/\/session\//);
  const assignmentSessionId = page.url().split("/").at(-1)!;
  expect(await prisma.learningSession.findUniqueOrThrow({ where: { id: assignmentSessionId } })).toMatchObject({ assignmentId, topic: goalTitle, objective: instructions, learnerLevel });
  await expect(page.locator(".learning-title p")).toHaveText(instructions);
  await page.getByText("任务信息", { exact: true }).click();
  await expect(page.getByText(learnerLevel, { exact: true })).toBeVisible();
  await fitsViewport(page);
});
