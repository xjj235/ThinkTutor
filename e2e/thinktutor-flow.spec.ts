import { expect, test } from "@playwright/test";

test("mock mode completes the ThinkTutor learning loop", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "问思学伴" })).toBeVisible();
  await page.getByRole("link", { name: "创建学生账号" }).click();
  await page.getByLabel("姓名").fill("端到端学生");
  await page.getByLabel("邮箱").fill(`flow-${testInfo.project.name}-${Date.now()}@example.test`);
  await page.getByLabel("密码").fill("Secure-e2e-password-2026");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/learn/new");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page.getByText("请填写知识点。")).toBeVisible();
  await expect(page.getByText("请填写学习目标。")).toBeVisible();
  await expect(page.getByText("请选择学习者水平。")).toBeVisible();
  await page.getByLabel("课程（可选）").fill("金融学导论");
  await page.getByLabel("章节（可选）").fill("风险与金融稳定");
  await page.getByLabel("知识点").fill("系统性风险");
  await page.getByLabel("学习目标").fill("理解局部冲击如何扩散为整体风险");
  await page.getByLabel("学习者水平").selectOption("有基础");
  await page
    .getByLabel("教师或课程参考材料（可选）")
    .fill("系统性风险通过关联、杠杆和流动性渠道传导。");
  await page.getByRole("button", { name: "创建并开始学习" }).click();

  await expect(page).toHaveURL(/\/session\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const originalSessionUrl = page.url();
  const originalSessionId = originalSessionUrl.split("/session/")[1] ?? "";

  await page.reload();
  await expect(
    page.locator(".learning-record-heading").getByText("认知诊断"),
  ).toBeVisible();
  const context = await page.locator(".learning-context").boundingBox();
  const record = await page.locator(".learning-main").boundingBox();
  expect(record!.y).toBeGreaterThanOrEqual(context!.y + context!.height);
  const stages = await page.locator(".phase-progress li").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().y));
  expect(new Set(stages).size).toBe(1);
  await expect(page.getByLabel("独立作答")).not.toHaveAttribute("maxlength");
  await expect(page.getByLabel("独立作答")).not.toHaveAttribute("minlength");
  await page.getByLabel("独立作答").fill(" \n　");
  await expect(page.getByRole("button", { name: "提交回答" })).toBeDisabled();
  await page
    .getByLabel("独立作答")
    .fill("否");
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(page.locator(".learning-record-heading").getByText("苏格拉底追问")).toBeVisible();
  await page.reload();
  await expect(page.locator(".learning-record-heading").getByText("苏格拉底追问")).toBeVisible();
  await expect(
    page.getByText("否", { exact: true }),
  ).toBeVisible();

  const answers = [
    `关键概念是传染，因为机构之间有共同资产和信心联系。${"长文本输入检验。".repeat(600)}`,
    "如果流动性下降，会导致抛售，所以风险会被放大。",
    "这个判断依赖机构之间高度关联的前提，因此前提变化会影响结论。",
    "我会检查共同资产持仓与实际抛售记录，因为只有这些证据才能支持价格下跌沿机构传导的解释。",
  ];

  for (const answer of answers) {
    await page.getByLabel("独立作答").fill(answer);
    await expect(page.getByLabel("独立作答")).toHaveValue(answer);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/answers") &&
          response.request().method() === "POST" &&
          response.ok(),
      ),
      page.getByRole("button", { name: "提交回答" }).click(),
    ]);
    await expect(page.getByText(/正在分析学习证据/)).toHaveCount(0);
  }

  await expect(page.getByLabel("费曼阐释")).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("learning-workspace.png"), fullPage: true });
  await expect(page.getByLabel("费曼阐释")).toBeVisible();
  await expect(page.getByLabel("费曼阐释")).not.toHaveAttribute("maxlength");
  await expect(page.getByLabel("费曼阐释")).not.toHaveAttribute("minlength");
  await page.getByLabel("费曼阐释").fill(" \n　");
  await expect(page.getByRole("button", { name: "生成学习报告" })).toBeDisabled();
  const longExplanation = "长篇阐释输入检验。".repeat(2500);
  await page.getByLabel("费曼阐释").fill(longExplanation);
  await expect(page.getByLabel("费曼阐释")).toHaveValue(longExplanation);
  await expect.poll(() => page.locator('.phase-progress [aria-current="step"]').evaluate((element) => {
    const track = element.closest("ol")!.getBoundingClientRect();
    const step = element.getBoundingClientRect();
    return step.left >= track.left - 1 && step.right <= track.right + 1;
  })).toBe(true);
  await page.reload();
  await expect(page.getByLabel("费曼阐释")).toBeVisible();
  await page
    .getByLabel("费曼阐释")
    .fill(
      "否",
    );
  await page.getByRole("button", { name: "生成学习报告" }).click();

  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByRole("heading", { name: "系统性风险", exact: true })).toBeVisible();
  await expect(page.getByText("五维能力评估")).toBeVisible();
  await expect(page.getByText("形成性学习报告")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("learning-report.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByText("五维能力评估")).toBeVisible();
  await expect(page.getByText("形成性学习报告")).toBeVisible();

  await page
    .getByRole("button", { name: "开启定向巩固" })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.locator("main")).toHaveAttribute(
    "data-parent-session-id",
    originalSessionId,
  );
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute(
    "data-parent-session-id",
    originalSessionId,
  );
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "学习总览" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-records.png"), fullPage: true });
});
