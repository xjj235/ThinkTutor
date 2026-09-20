import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, allowExitOnIdle: true, max: 4 }) });
const envelope = z.object({ data: z.object({ session: z.object({ id: z.string(), version: z.number() }), messages: z.array(z.object({ role: z.string(), content: z.string() })) }) });
test.afterAll(async () => prisma.$disconnect());

async function register(page: Page) {
  const email = `audit-browser-${crypto.randomUUID()}@example.test`;
  const response = await page.request.post("/api/auth/register", { data: { name: "复查测试学生", email, password: "Audit-resilience-2026!" } });
  expect(response.status()).toBe(201);
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

async function createSession(page: Page) {
  const response = await page.request.post("/api/sessions", { data: {
    topic: "论证证据", objective: "解释主张与证据之间的关系", learnerLevel: "有基础", clientRequestId: crypto.randomUUID(),
  } });
  expect(response.status()).toBe(201);
  return envelope.parse(await response.json()).data;
}

for (const recovery of ["conflict", "refresh"] as const) {
test(`an outdated tab preserves its draft without applying it to the next question (${recovery})`, async ({ page, context }) => {
  await register(page);
  const created = await createSession(page);
  await page.goto(`/session/${created.session.id}`);
  const other = await context.newPage();
  try {
    await other.goto(`/session/${created.session.id}`);
    const oldDraft = "这是针对初始诊断的旧草稿，尚未回答后来出现的追问。";
    await other.getByLabel("独立作答").fill(oldDraft);
    if (recovery === "refresh") {
      await other.route("**/api/sessions/*/answers", async (route) => {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "请检查本次回答。", retryable: false } }) });
      });
      await other.getByRole("button", { name: "提交回答", exact: true }).click();
      await expect(other.getByRole("button", { name: "刷新会话", exact: true })).toBeVisible();
      await other.unroute("**/api/sessions/*/answers");
    }
    await page.getByLabel("独立作答").fill("我认为证据需要支持具体主张，并说明由证据到结论的推理关系。");
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(page.getByLabel("独立作答")).toHaveValue("");
    const before = envelope.parse(await (await page.request.get(`/api/sessions/${created.session.id}`)).json()).data;
    if (recovery === "conflict") {
      await other.getByRole("button", { name: "提交回答", exact: true }).click();
      await expect(other.getByRole("button", { name: "同步最新进度", exact: true })).toBeVisible();
      await expect(other.getByLabel("独立作答")).toBeDisabled();
    }
    const after = envelope.parse(await (await page.request.get(`/api/sessions/${created.session.id}`)).json()).data;
    expect(after).toEqual(before);
    await other.getByRole("button", { name: recovery === "conflict" ? "同步最新进度" : "刷新会话", exact: true }).click();
    await expect(other.getByLabel("上次未确认的回答", { exact: true })).toHaveValue(oldDraft);
    await expect(other.getByLabel("独立作答")).toHaveValue("");
    await other.getByLabel("独立作答").fill("阅读新的追问后，我会检查证据是否相关，以及是否存在其他解释。");
    await other.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(other.getByLabel("独立作答")).toHaveValue("");
    await expect(other.locator("main").getByRole("alert")).toHaveCount(0);
  } finally { await other.close(); }
});
}

test("self-directed learning starts when randomUUID is unavailable on a LAN browser", async ({ page }) => {
  await register(page);
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true }));
  await page.goto("/learn/new");
  await page.getByLabel("知识点").fill("论证证据");
  await page.getByLabel("学习目标").fill("解释证据怎样支持主张");
  await page.getByLabel("学习者水平").selectOption("有基础");
  await page.getByRole("button", { name: "创建并开始学习", exact: true }).click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.getByLabel("独立作答")).toBeEnabled();
  await page.getByLabel("独立作答").fill("证据需要与主张相关，并说明推理的条件。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByLabel("独立作答")).toHaveValue("");
});

test("assignment start works without randomUUID and stays locked until navigation completes", async ({ page }) => {
  const student = await register(page);
  const teacher = await prisma.user.create({ data: { email: `audit-teacher-${crypto.randomUUID()}@example.test`, name: "教师", passwordHash: student.passwordHash, role: "TEACHER" } });
  const course = await prisma.course.create({ data: { title: "论证课程", ownerId: teacher.id, status: "PUBLISHED" } });
  const classroom = await prisma.classroom.create({ data: { name: "论证班", teacherId: teacher.id, courseId: course.id, joinCode: crypto.randomUUID(), enrollments: { create: { userId: student.id, status: "ACTIVE" } } } });
  const assignment = await prisma.assignment.create({ data: { title: "证据任务", instructions: "解释主张与证据的联系", learnerLevel: "有基础", courseId: course.id, classroomId: classroom.id, createdById: teacher.id, status: "PUBLISHED", maxAttempts: 2, students: { create: { studentId: student.id } } } });
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true }));
  await page.goto(`/assignments/${assignment.id}`);
  await holdNavigationAndVerifyLock(page, "开始这项学习", "正在生成诊断…", "/api/sessions");
  expect(await prisma.learningSession.count({ where: { assignmentId: assignment.id, userId: student.id } })).toBe(1);
});

test("retry creation cannot launch another gap while its successful navigation is pending", async ({ page }) => {
  const student = await register(page);
  const session = await prisma.learningSession.create({ data: {
    userId: student.id, topic: "论证证据", objective: "检查推理条件", learnerLevel: "有基础", phase: "COMPLETED",
    report: { create: { summary: "尚需检验推理条件", overallScore: 50, overallLevel: "形成性评价", disclaimer: "自动化流程测试",
      dimensions: { create: (["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"] as const).map((key) => ({ key, score: 50, evidence: "尚未说明推理条件", feedback: "补充条件" })) },
      gaps: { create: [5, 4].map((priority) => ({ title: `待检验条件${priority}`, evidence: "尚未独立检验条件变化", repairTask: "分析条件变化对结论的影响", priority })) },
    } },
  } });
  await page.goto(`/report/${session.id}`);
  await holdNavigationAndVerifyLock(page, "开启定向巩固", "正在创建...", `/api/sessions/${session.id}/retry`);
  expect(await prisma.learningSession.count({ where: { parentSessionId: session.id } })).toBe(1);
});

async function holdNavigationAndVerifyLock(page: Page, startLabel: string, busyLabel: string, mutationPath: string) {
  let requests = 0;
  let navigationHeld = false;
  let releaseNavigation = () => {};
  const gate = new Promise<void>((resolve) => { releaseNavigation = resolve; });
  await page.route(`**${mutationPath}`, async (route) => {
    if (route.request().method() === "POST") requests++;
    await route.continue();
  });
  await page.route("**/session/*", async (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/session/")) { await route.continue(); return; }
    navigationHeld = true;
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: startLabel, exact: true }).click();
    await expect.poll(() => navigationHeld).toBe(true);
    await expect(page.getByRole("button", { name: busyLabel, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: busyLabel, exact: true }).evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error("Missing start button");
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(requests).toBe(1);
  } finally { releaseNavigation(); }
  await expect(page).toHaveURL(/\/session\//);
  expect(requests).toBe(1);
}
