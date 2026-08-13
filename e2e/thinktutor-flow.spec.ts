import { expect, test } from "@playwright/test";

test("mock mode completes the ThinkTutor learning loop", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /从“好像懂了”\s*到真正讲清楚/ })).toBeVisible();
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
    page.getByText("知识诊断阶段，系统每次只推进一个问题。"),
  ).toBeVisible();
  await page
    .getByLabel("你的回答")
    .fill("我认为系统性风险是单个机构的问题扩散到整个市场。");
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(page.getByText("苏格拉底追问阶段")).toBeVisible();
  await page.reload();
  await expect(page.getByText("苏格拉底追问阶段")).toBeVisible();
  await expect(
    page.getByText("我认为系统性风险是单个机构的问题扩散到整个市场。"),
  ).toBeVisible();

  const answers = [
    "关键概念是传染，因为机构之间有共同资产和信心联系。",
    "如果流动性下降，会导致抛售，所以风险会被放大。",
    "这个判断依赖机构之间高度关联的前提，因此前提变化会影响结论。",
  ];

  for (const answer of answers) {
    await page.getByLabel("你的回答").fill(answer);
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/answers") &&
          response.request().method() === "POST" &&
          response.ok(),
      ),
      page.getByRole("button", { name: "提交回答" }).click(),
    ]);
    await expect(page.getByText(/正在生成下一步问题/)).toHaveCount(0);
  }

  await expect(
    page.getByRole("button", { name: "进入费曼讲解" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "进入费曼讲解" }).click();
  await expect(page.getByLabel("费曼讲解")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("费曼讲解")).toBeVisible();
  await page
    .getByLabel("费曼讲解")
    .fill(
      "系统性风险是局部冲击通过机构关联、杠杆和流动性扩散为整体金融风险。例如一家大机构被迫卖资产会导致价格下跌，所以其他机构也会亏损。如果换到供应链场景，也要检查节点之间是否高度依赖。",
    );
  await page.getByRole("button", { name: "生成学习报告" }).click();

  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByRole("heading", { name: "系统性风险" })).toBeVisible();
  await expect(page.getByText("五维诊断")).toBeVisible();
  await expect(page.getByText("形成性学习反馈")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByText("五维诊断")).toBeVisible();
  await expect(page.getByText("形成性学习反馈")).toBeVisible();

  await page
    .getByRole("button", { name: "针对最高优先级漏洞再练一轮" })
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
});
