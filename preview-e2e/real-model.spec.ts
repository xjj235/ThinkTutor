import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { knowledgeRuntimeSchema } from "../src/lib/knowledge/runtime-schemas";

test("explicitly enabled local preview assesses an HTML answer with the real model", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_PREVIEW_LIVE_TEST !== "true", "Real model calls require an explicit opt-in.");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const base = new URL(process.env.PREVIEW_BASE_URL ?? "http://127.0.0.1:3100");
  expect(["127.0.0.1", "localhost"]).toContain(base.hostname);
  const databaseUrl = new URL(process.env.PREVIEW_DATABASE_URL!);
  expect(databaseUrl.hostname).toBe("127.0.0.1");
  expect(databaseUrl.pathname).toBe("/thinktutor_preview");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl.href, max: 2 }) });
  const email = `live-preview-${crypto.randomUUID()}@example.test`;
  const password = `Live-preview-${crypto.randomUUID()}`;
  try {
    const ready = await page.request.get("/api/health/ready");
    expect(ready.ok()).toBe(true);
    expect(await ready.text()).toContain('"aiProvider":"deepseek"');
    await page.goto("/");
    await expect(page.getByText("DeepSeek 真实模型已启用，调用将消耗 API 额度。", { exact: true })).toBeVisible();
    await expect(page.getByText("Mock AI 与本地数据已启用，不产生模型费用。", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("real-model-status.png"), fullPage: true });
    await page.goto("/register");
    await page.getByLabel("姓名").fill("真实模型验证");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "创建学生账号" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/learn/new");
    await page.getByRole("textbox", { name: "知识点" }).fill("解释风险传播路径");
    await page.getByRole("textbox", { name: "学习目标" }).fill("解释系统性风险的传播机制及其成立条件。");
    await page.getByLabel("学习者水平").selectOption("有基础");
    await page.getByRole("button", { name: "创建并开始学习" }).click();
    await expect(page).toHaveURL(/\/session\//);
    const sessionId = page.url().split("/session/")[1];
    await page.getByRole("button", { name: "确认目标并开始" }).click();
    const answer = "我认为系统性风险的研究对象是金融体系，而非某一家机构的经营损失。关键是冲击通过机构之间的联系向其他主体传播，并使支付、信贷等金融功能受到广泛影响。例如多家银行持有同类资产，其中一家被迫集中出售会压低价格，使其他持有者受损并继续出售，形成反馈。单家银行退出市场本身还不足以作出系统性风险判断。";
    await page.getByLabel("独立作答").fill(answer);
    const pending = page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST", { timeout: 150_000 });
    await page.getByRole("button", { name: "提交回答" }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBe(200);
    await expect(page.getByText(/原文依据：|待核验的表述：/)).toBeVisible();
    const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } });
    const runtime = knowledgeRuntimeSchema.parse(saved.knowledgeRuntime);
    expect(runtime.versions.releaseId).toBe("KR_SR_1_2");
    expect(Object.keys(runtime.v12!.assessments)).toHaveLength(1);
    const usage = await prisma.aIUsage.findFirstOrThrow({ where: { sessionId, operation: "turn_assessment", status: "SUCCESS" }, orderBy: { createdAt: "desc" }, select: { provider: true, model: true, status: true, promptTokens: true, completionTokens: true, latencyMs: true, retryCount: true } });
    expect(usage.provider).toBe("deepseek");
    expect(usage.promptTokens).toBeGreaterThan(0);
    expect(usage.completionTokens).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("real-model-feedback.png"), fullPage: true });
    await testInfo.attach("real-model-usage", { body: JSON.stringify(usage, null, 2), contentType: "application/json" });
    console.log(JSON.stringify({ realModelVerification: usage }));
  } finally {
    try {
      await prisma.user.deleteMany({ where: { email, role: "STUDENT" } });
    } finally { await prisma.$disconnect(); }
  }
});
