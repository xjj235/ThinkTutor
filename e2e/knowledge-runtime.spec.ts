import { expect, test } from "@playwright/test";
import manifest from "../knowledge/courses/financial-risk-management/systemic-risk/manifest.json" with { type: "json" };
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";
import { knowledgeRuntimeSchema } from "../src/lib/knowledge/runtime-schemas";

test("curated knowledge follows a course goal and gives grounded feedback in HTML", async ({ page }, testInfo) => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE !== "true", "Curated draft requires an explicit development override.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2 }) });
  const suffix = crypto.randomUUID();
  const password = "Secure-grounded-e2e-2026";
  try {
    const teacher = await prisma.user.create({ data: { email: `grounded-teacher-${suffix}@example.test`, name: "课程教师", role: "TEACHER", passwordHash: await hash(password) } });
    const student = await prisma.user.create({ data: { email: `grounded-student-${suffix}@example.test`, name: "课程学生", role: "STUDENT", passwordHash: await hash(password) } });
    const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "金融系统与风险", status: "PUBLISHED" } });
    const chapter = await prisma.chapter.create({ data: { courseId: course.id, title: "系统性风险", sortOrder: 1 } });
    const goal = await prisma.learningGoal.create({ data: { courseId: course.id, chapterId: chapter.id, title: "解释风险传播路径", objective: "能够用条件、传播渠道和系统后果解释系统性风险。", sortOrder: 1 } });
    const classroom = await prisma.classroom.create({ data: { courseId: course.id, teacherId: teacher.id, name: "知识库测试班", joinCode: suffix.slice(0, 8) } });
    await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: student.id } });
    await page.goto("/login");
    await page.getByLabel("邮箱").fill(student.email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/learn/new");
    await page.locator("#curriculum-course").selectOption(course.id);
    await page.locator("#curriculum-chapter").selectOption(chapter.id);
    await page.locator("#curriculum-goal").selectOption(goal.id);
    await page.getByLabel("学习者水平").selectOption("入门");
    await page.getByRole("button", { name: "创建并开始学习" }).click();
    await expect(page).toHaveURL(/\/session\//);
    await page.getByRole("button", { name: "确认目标并开始" }).click();
    await expect(page.getByText(manifest.diagnosticQuestions[0].questionText, { exact: true })).toBeVisible();
    const answer = "系统性风险关注金融体系，但我还没有说明它怎样影响其他机构。";
    await page.getByLabel("独立作答").fill(answer);
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByText(/原文依据：/)).toBeVisible();
    await expect(page.getByText(/下一步至少澄清一项：/)).toBeVisible();
    const sessionId = page.url().split("/session/")[1];
    const state = await page.request.get(`/api/sessions/${sessionId}`);
    expect(state.ok()).toBe(true);
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(knowledgeRuntimeSchema.parse(saved.knowledgeRuntime).versions.releaseId).toBe("KR_SR_1_2");
    const quotes = page.getByText(/原文依据：/);
    await page.reload();
    await expect(quotes).toBeVisible();
    await expect(page.getByText(/下一步至少澄清一项：/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("grounded-feedback.png"), fullPage: true });
  } finally {
    await prisma.$disconnect();
  }
});

test("curated knowledge runs through browser and preserves the versioned report", async ({ page }, testInfo) => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE !== "true", "Curated draft requires an explicit development override.");
  await page.goto("/register");
  await page.getByLabel("姓名").fill("知识库测试学生");
  await page.getByLabel("邮箱").fill(`knowledge-${testInfo.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("密码").fill("Secure-e2e-password-2026");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/learn/new");
  await page.getByLabel("知识点").fill("系统性风险");
  await page.getByLabel("学习目标").fill("解释风险传播机制并完成案例迁移");
  await page.getByLabel("学习者水平").selectOption("有基础");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  await page.getByRole("button", { name: "确认目标并开始" }).click();
  await expect(page.getByText(manifest.diagnosticQuestions[0].questionText, { exact: true })).toBeVisible();
  const answer = "首先，Systemic关注金融体系功能，Systematic关注不可分散的市场风险，二者研究对象不同。单家倒闭不等于系统性风险。例如初始冲击为房价下跌，没有直接借贷也可以通过共同持仓传播，多家机构同时受损。因为被迫抛售造成价格下跌和进一步损失，所以反馈放大引起金融功能受损。直接债权债务可传递违约损失。集中提款增加现金需求，被迫出售长期资产。负面信息造成预期变化，其他银行也出现提款并跨机构扩散。信贷收缩造成投资和就业下降。规模不是唯一因素，还有关联性和可替代性。个体自保形成同步行动与系统反馈。繁荣期杠杆上升形成风险累积，支付清算故障造成支付中断。最后，如果关键服务可替代，那么功能未受损时就不应判断为系统性事件。";
  for (let index = 0; index < 8; index += 1) {
    await page.getByLabel("独立作答").fill(`${answer}这是第${index}次的独立回答。`);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST" && response.ok()),
      page.getByRole("button", { name: "提交回答" }).click(),
    ]);
    await expect(page.getByText(/正在分析学习证据/)).toHaveCount(0);
    if (index === 4) {
      await expect(page.getByRole("button", { name: "进入费曼阐释" })).toHaveCount(0);
      await expect(page.getByText(/教学合成案例/).first()).toBeVisible();
      await expect(page.getByText(/你能围绕.*解释这段情境中的风险机制吗/)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("case-transfer.png"), fullPage: true });
      await page.reload();
    }
  }
  await expect(page.getByLabel("费曼阐释")).toBeVisible();
  await expect(page.getByLabel("费曼阐释")).not.toHaveAttribute("maxlength");
  await page.getByLabel("费曼阐释").fill("否");
  await expect(page.getByRole("button", { name: "提交讲解", exact: true })).toBeEnabled();
  await page.getByLabel("费曼阐释").fill(`${answer}这是我的完整自主讲解。`);
  await page.getByRole("button", { name: "提交讲解", exact: true }).click();
  await expect(page.getByLabel("反思修订")).toBeVisible();
  await expect(page.getByLabel("反思修订")).not.toHaveAttribute("maxlength");
  await page.getByLabel("反思修订").fill(" \n　");
  await expect(page.getByRole("button", { name: "提交修订并生成报告" })).toBeDisabled();
  await page.getByLabel("反思修订").fill("否");
  await expect(page.getByRole("button", { name: "提交修订并生成报告" })).toBeEnabled();
  const longRevision = "长篇修订输入检验。".repeat(2500);
  await page.getByLabel("反思修订").fill(longRevision);
  await expect(page.getByLabel("反思修订")).toHaveValue(longRevision);
  await page.getByLabel("反思修订").fill(`${answer}这是检查关键条件后的最终修订。`);
  const reportResponse = page.waitForResponse((response) => response.url().endsWith("/feynman") && response.request().method() === "POST" && response.ok());
  await page.getByRole("button", { name: "提交修订并生成报告" }).click();
  const response = await reportResponse;
  expect(JSON.stringify(await response.json())).toContain("KR_SR_1_2");
  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByText("五维能力评估")).toBeVisible();
  await page.reload();
  await expect(page.getByText("五维能力评估")).toBeVisible();
  const sessionId = page.url().split("/report/")[1];
  const restoredReport = await page.request.get(`/api/reports/${sessionId}`);
  expect(await restoredReport.text()).toContain("KR_SR_1_2");
  await page.getByText("查看评分原文", { exact: true }).first().click();
  await expect(page.getByText("判断与版本记录", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("versioned-report.png"), fullPage: true });
});
