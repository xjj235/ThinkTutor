import { expect, test } from "@playwright/test";
import type { ApiSuccess, SessionPayload } from "../src/lib/contracts";

test("students can see why each question follows their answer and revisit their learning changes", async ({ page }, testInfo) => {
  await page.goto("/register");
  await page.getByLabel("姓名").fill("追问解释验收");
  await page.getByLabel("邮箱").fill(`coaching-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Coaching-test-2026!");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("link", { name: "新建学习任务", exact: true }).click();
  await page.getByLabel("知识点").fill("杠杆与收益");
  await page.getByLabel("学习目标").fill("区分借款放大收益的条件和风险");
  await page.getByLabel("学习者水平").selectOption("入门");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionUrl = page.url();
  const answers = [
    "我觉得借钱投资总能提高收益。",
    "不知道，借款和收益之间我还没有想清楚。",
    "借款有成本，因为收益需要先扣除利息，所以是否赚得更多和投资回报有关。",
    "例如投资收益低于借款成本时会亏损，如果回报超过利息才可能提高收益。",
    "证据可以比较投资前后的回报记录与借款合同，而不是只看资产价格上涨。",
    "换到住房投资这个场景，还要检查利率变化、空置成本和本金偿还的条件。",
  ];
  let completedQuestioning = false;
  let feedbackCount = 0;
  for (const answer of answers) {
    await page.getByLabel("独立作答").fill(answer);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST");
    await page.getByRole("button", { name: "提交回答" }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const payload = (await response.json() as ApiSuccess<SessionPayload>).data;
    const feedback = payload.messages.at(-1)!.learningFeedback!;
    expect(feedback).toBeTruthy();
    expect(answer).toContain(feedback.answerQuote);
    expect(payload.messages.at(-1)!.feedbackForMessageId).toBe(payload.messages.at(-2)!.id);
    const current = page.getByLabel("本轮反馈与任务", { exact: true });
    await expect(current.getByRole("heading", { name: "从你的回答出发" })).toBeVisible();
    await expect(current.getByText(feedback.focus, { exact: true })).toBeVisible();
    await expect(current.getByText(feedback.whyItMatters, { exact: true })).toBeVisible();
    if (payload.messages.at(-1)?.questionType === "COUNTEREXAMPLE") {
      await expect(current.locator(".question-type-label")).toHaveText("情形检验");
    }
    await expect(current).toBeFocused();
    const feedbackBox = await current.getByTestId("learning-feedback").boundingBox();
    const questionBox = await current.locator(".feedback-question").boundingBox();
    expect(questionBox!.y).toBeGreaterThanOrEqual(feedbackBox!.y + feedbackBox!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    feedbackCount++;
    if (feedbackCount === 1) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: testInfo.outputPath("answer-connected-feedback.png"), fullPage: true });
      await page.reload();
      await expect(current.getByText(feedback.whyItMatters, { exact: true })).toBeVisible();
      await page.locator("#learning-history > summary").click();
      await expect(page.locator('[data-role="USER"]').getByText(answer, { exact: true })).toBeVisible();
      await page.locator("#learning-history > summary").click();
      if (payload.availableActions?.canRequestHint) {
        const hintResponse = page.waitForResponse((reply) => reply.url().endsWith("/hint") && reply.request().method() === "POST");
        await page.getByRole("button", { name: /提示/ }).click();
        expect((await hintResponse).ok()).toBe(true);
        await expect(current.getByTestId("learning-feedback")).toHaveCount(1);
        await expect(current.getByText(feedback.whyItMatters, { exact: true })).toBeVisible();
      }
    }
    completedQuestioning = payload.session.phase === "FEYNMAN";
    if (completedQuestioning) break;
  }
  expect(completedQuestioning).toBe(true);
  await expect(page.getByRole("heading", { name: "我的理解如何变化" })).toBeVisible();
  await expect(page.locator(".learning-journey > ol > li")).toHaveCount(feedbackCount);
  await page.getByLabel("费曼阐释", { exact: true }).fill("杠杆通过借款扩大投资规模，也增加偿付成本。例如投资回报低于利息时，借钱可能放大亏损。如果迁移到住房投资，还需要检查空置与利率变化，所以不能保证总能提高收益。");
  await page.getByRole("button", { name: "生成学习报告" }).click();
  await expect(page).toHaveURL(/\/report\//);
  await page.reload();
  await expect(page.getByRole("heading", { name: "我的理解如何变化" })).toBeVisible();
  await expect(page.locator(".learning-journey > ol > li")).toHaveCount(feedbackCount);
  await expect(page.getByTestId("independent-explanation-step")).toHaveCount(0);
  const finalStep = page.locator(".learning-journey > ol > li").last();
  await finalStep.locator("summary").click();
  await expect(finalStep.getByTestId("journey-report-feedback")).toBeVisible();
  await expect(finalStep.getByTestId("journey-report-feedback")).toContainText("整次学习");
  await page.locator(".learning-journey summary").first().click();
  await expect(page.getByText("我原来的表达", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("我后来的补充", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("learning-changes-report.png"), fullPage: true });
  await page.getByRole("link", { name: "查看完整作答记录" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${sessionUrl}#message-`));
  await expect(page.locator("#learning-history")).toHaveAttribute("open", "");
  await expect(page.locator('[data-role="USER"]').getByText(answers[0], { exact: true })).toBeVisible();
});

test("voluntary Feynman explanation remains connected to its report without answering the replaced question", async ({ page }, testInfo) => {
  await page.goto("/register");
  await page.getByLabel("姓名").fill("独立讲解回看验收");
  await page.getByLabel("邮箱").fill(`feynman-journey-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Coaching-test-2026!");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("link", { name: "新建学习任务", exact: true }).click();
  await page.getByLabel("知识点").fill("汇率风险");
  await page.getByLabel("学习目标").fill("解释外币现金流的折算价值为什么变化");
  await page.getByLabel("学习者水平").selectOption("有基础");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  for (const answer of [
    "外币现金流的折算价值随汇率变化。",
    "汇率风险是外币款项的折算价值变化。",
    "因为汇率发生变化，会导致外币款项的折算金额变化。",
    "如果企业有外币应收，本币升值会降低折算价值。",
    "合同约定企业将在月底收取一笔美元货款，这就是外币应收的证据。",
  ]) {
    await page.getByLabel("独立作答").fill(answer);
    const reply = page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST");
    await page.getByRole("button", { name: "提交回答" }).click();
    expect((await reply).ok()).toBe(true);
    await expect(page.getByLabel("独立作答")).toHaveValue("");
  }
  await page.getByRole("button", { name: "进入费曼阐释", exact: true }).click();
  await expect(page.getByLabel("费曼阐释", { exact: true })).toBeVisible();
  const independent = page.getByTestId("independent-explanation-step");
  await expect(independent).toHaveCount(1);
  await independent.locator("summary").click();
  await expect(independent).toContainText("还没有新的作答记录");
  const explanation = "汇率风险是外币款项的折算价值变化，因为汇率会影响折算金额。例如持有美元应收款的企业，在本币升值时折算价值可能减少；合同与结算记录可用于核对这笔风险。";
  await page.getByLabel("费曼阐释", { exact: true }).fill(explanation);
  await page.getByRole("button", { name: "生成学习报告" }).click();
  await expect(page).toHaveURL(/\/report\//);
  await page.reload();
  await expect(independent).toHaveCount(1);
  await independent.locator("summary").click();
  await expect(independent.getByText(explanation, { exact: true })).toBeVisible();
  await expect(independent.getByTestId("journey-report-feedback")).toBeVisible();
  await expect(independent.getByTestId("journey-report-feedback")).toContainText("整次学习");
  const replaced = page.locator(".learning-journey > ol > li").nth(4);
  await replaced.locator("summary").click();
  await expect(replaced).toContainText("这条追问没有对应的后续作答");
  await expect(replaced.getByText(explanation, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("independent-explanation-report.png"), fullPage: true });
  await independent.screenshot({ path: testInfo.outputPath("feynman-task-and-report.png") });
  await independent.getByRole("link", { name: /查看完整/ }).click();
  await expect(page).toHaveURL(/\/session\/[^/]+#message-/);
  await expect(page.locator('[data-role="USER"]').getByText(explanation, { exact: true })).toBeVisible();
});
