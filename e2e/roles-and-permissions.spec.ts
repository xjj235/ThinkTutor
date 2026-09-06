import { expect, request as playwrightRequest, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UserRole } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-e2e-password-2026";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 5 }),
});

async function createRoleUser(role: UserRole, label: string) {
  return prisma.user.create({ data: { email: `${label}-${crypto.randomUUID()}@example.test`, name: `${label} 用户`, passwordHash: await hash(password), role } });
}

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}

test.afterAll(async () => prisma.$disconnect());

test("role dashboards and server-side ownership rules are enforced", async ({ page, baseURL }) => {
  const [teacherA, teacherB, admin, studentA, studentB] = await Promise.all([
    createRoleUser("TEACHER", "teacher-a"), createRoleUser("TEACHER", "teacher-b"), createRoleUser("ADMIN", "admin"), createRoleUser("STUDENT", "student-a"), createRoleUser("STUDENT", "student-b"),
  ]);
  const foreignCourse = await prisma.course.create({ data: { ownerId: teacherB.id, title: "教师乙课程" } });
  const studentCourse = await prisma.course.create({ data: { ownerId: teacherB.id, title: "学生可见课程", status: "PUBLISHED" } });
  const privateJoinCode = `P${crypto.randomUUID().replaceAll("-", "").slice(0, 11).toUpperCase()}`;
  const studentClassroom = await prisma.classroom.create({ data: { courseId: studentCourse.id, teacherId: teacherB.id, name: "隔离测试班级", joinCode: privateJoinCode } });
  await prisma.enrollment.createMany({ data: [studentA.id, studentB.id].map((userId) => ({ classroomId: studentClassroom.id, userId })) });
  await prisma.assignment.createMany({ data: [
    { courseId: studentCourse.id, classroomId: studentClassroom.id, createdById: teacherB.id, title: "学生可见任务", instructions: "可见", learnerLevel: "入门", status: "PUBLISHED" },
    { courseId: studentCourse.id, classroomId: studentClassroom.id, createdById: teacherB.id, title: "教师私密草稿", instructions: "私密", learnerLevel: "入门", status: "DRAFT" },
  ] });

  await login(page, teacherA.email);
  await expect(page).toHaveURL(/\/teacher/);
  await expect(page.getByRole("heading", { name: "教学总览" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/teacher/courses/new");
  await page.getByLabel("课程名称").fill("教师甲的测试课程");
  await page.getByRole("button", { name: "创建课程" }).click();
  await expect(page).toHaveURL(/\/teacher\/courses\/(?!new$)[^/]+$/);
  await expect(page.getByRole("heading", { name: "教师甲的测试课程" })).toBeVisible();
  expect((await page.request.delete("/api/me", { data: { password } })).status()).toBe(409);
  expect((await page.request.get(`/api/courses/${foreignCourse.id}`)).status()).toBe(403);
  expect((await page.request.get("/api/admin/overview")).status()).toBe(403);

  const studentBContext = await playwrightRequest.newContext({ baseURL });
  await studentBContext.post("/api/auth/login", { data: { email: studentB.email, password } });
  const createdForB = await studentBContext.post("/api/sessions", { data: { topic: "学生乙知识点", objective: "验证学生之间的会话隔离", learnerLevel: "入门", clientRequestId: `student-b-${crypto.randomUUID()}` } });
  const bodyForB = await createdForB.json() as { data: { session: { id: string } } };

  await page.request.post("/api/auth/logout", { data: {} });
  await login(page, studentA.email);
  await expect(page).toHaveURL(/\/dashboard/);
  const classResponse = await page.request.get(`/api/classes/${studentClassroom.id}`);
  expect(classResponse.status()).toBe(200);
  const classText = await classResponse.text();
  expect(classText).not.toContain(privateJoinCode);
  expect(classText).not.toContain(studentB.email);
  expect(classText).not.toContain("教师私密草稿");
  expect(classText).toContain("学生可见任务");
  const privateReference = "不得返回浏览器的私有参考材料";
  const minimizedSession = await page.request.post("/api/sessions", { data: { topic: "最小披露", objective: "验证浏览器响应不含私有字段", learnerLevel: "入门", referenceText: privateReference, clientRequestId: `minimized-${crypto.randomUUID()}` } });
  expect(minimizedSession.status()).toBe(201);
  const minimizedText = await minimizedSession.text();
  expect(minimizedText).not.toContain(privateReference);
  expect(minimizedText).not.toContain(studentA.id);
  expect(minimizedText).not.toContain("learnerState");
  expect((await page.request.get(`/api/sessions/${bodyForB.data.session.id}`)).status()).toBe(403);
  expect((await page.request.post("/api/courses", { data: { title: "越权课程" } })).status()).toBe(403);
  await prisma.user.update({ where: { id: studentA.id }, data: { status: "DISABLED" } });
  expect((await page.request.post("/api/sessions", { data: { topic: "停用后请求", objective: "停用账号不能继续创建学习会话", learnerLevel: "入门", clientRequestId: `disabled-${crypto.randomUUID()}` } })).status()).toBe(401);

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(admin.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "管理总览" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await prisma.auditLog.count({ where: { actorId: admin.id, action: "AUTH_LOGIN" } })).toBe(1);
  expect(await prisma.auditLog.count({ where: { actorId: teacherA.id, action: "AUTH_LOGIN" } })).toBeGreaterThanOrEqual(1);

  await studentBContext.dispose();
});
