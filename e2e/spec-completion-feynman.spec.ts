import { expect, test } from "@playwright/test";
import type { ApiSuccess, LearningReportDTO, SessionPayload } from "../src/lib/contracts";

test("curated knowledge requires independent explanation at the turn limit before reflection and report", async ({ page }, testInfo) => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE !== "true", "Curated draft requires an explicit development override.");
  test.setTimeout(120_000);
  await page.goto("/register");
  await page.getByLabel("姓名").fill("追问上限验收学生");
  await page.getByLabel("邮箱").fill(`feynman-limit-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Secure-e2e-password-2026");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/learn/new");
  await page.getByLabel("知识点").fill("系统性风险");
  await page.getByLabel("学习目标").fill("解释金融风险的传播机制和适用条件");
  await page.getByLabel("学习者水平").selectOption("入门");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionUrl = page.url();
  await page.getByRole("button", { name: "确认目标并开始" }).click();
  await expect(page.getByLabel("独立作答")).toBeVisible();

  let reachedLimit = false;
  for (let index = 0; index < 25 && !reachedLimit; index += 1) {
    await page.getByLabel("独立作答").fill(`共同资产价格下跌可能增加融资压力，造成进一步的抛售和信贷收缩。这是第${index}次独立分析。`);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST");
    await page.getByRole("button", { name: "提交回答" }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const result = await response.json() as ApiSuccess<SessionPayload>;
    reachedLimit = result.data.session.phase === "FEYNMAN";
    if (reachedLimit) {
      expect(result.data.session.socraticTurns).toBe(5);
      expect(result.data.session.knowledgeProgress).toMatchObject({ pedagogicalStage: "FEYNMAN_OUTPUT", experienceLimitReached: true });
      expect(result.data.report).toBeNull();
    }
    await expect(page.getByText(/正在分析学习证据/)).toHaveCount(0);
  }
  expect(reachedLimit).toBe(true);
  await expect(page.getByLabel("费曼阐释")).toBeVisible();
  await expect(page.getByLabel("反思修订")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("费曼阐释")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("required-explanation.png"), fullPage: true });

  await page.getByLabel("费曼阐释").fill("我向初学者解释：金融体系中，共同资产的价格下跌会传播风险。例如银行同时抛售资产，价格进一步下降并引起信贷收缩。");
  const explanationResponse = page.waitForResponse((response) => response.url().endsWith("/feynman") && response.request().method() === "POST");
  await page.getByRole("button", { name: "提交讲解", exact: true }).click();
  const response = await explanationResponse;
  expect(response.ok()).toBe(true);
  const explained = await response.json() as ApiSuccess<{ payload: SessionPayload; report: LearningReportDTO | null }>;
  expect(explained.data.report).toBeNull();
  expect(explained.data.payload.session.knowledgeProgress?.pedagogicalStage).toBe("REFLECTION");
  await expect(page).toHaveURL(sessionUrl);
  await expect(page.getByLabel("反思修订")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("反思修订")).toBeVisible();
  await page.getByLabel("反思修订").fill("我修订刚才的讲解：例如共同持仓受到冲击后，集中抛售让风险传播，金融体系的信贷收缩还可能影响投资与就业。");
  await page.getByRole("button", { name: "提交修订并生成报告" }).click();
  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByText("五维能力评估")).toBeVisible();
  await page.reload();
  await expect(page.getByText("五维能力评估")).toBeVisible();
  const sessionId = sessionUrl.split("/session/")[1];
  const restored = await page.request.get(`/api/sessions/${sessionId}`);
  expect(restored.ok()).toBe(true);
  const completed = await restored.json() as ApiSuccess<SessionPayload>;
  expect(completed.data.session.phase).toBe("COMPLETED");
  expect(completed.data.report?.evidenceAudit).toMatchObject({ experienceLimitReached: true, transferPassed: false });
  expect(completed.data.report!.evidenceAudit!.finalFeynmanMessageId).toBeTruthy();
  expect(completed.data.report!.evidenceAudit!.finalRevisionMessageId).toBeTruthy();
  expect(completed.data.report!.evidenceAudit!.finalFeynmanMessageId).not.toBe(completed.data.report!.evidenceAudit!.finalRevisionMessageId);
  expect(completed.data.report!.dimensions.transferAbility.score).toBeLessThanOrEqual(50);
  expect(completed.data.report!.gaps.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("limit-report.png"), fullPage: true });
});
