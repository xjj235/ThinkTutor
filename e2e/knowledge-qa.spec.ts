import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const sessionEnvelopeSchema = z.object({
  data: z.object({ session: z.object({ id: z.string(), topic: z.string(), phase: z.string() }) }),
});
const retryRequestSchema = z.object({ clientRequestId: z.string() });
const subjects = [
  {
    topicId: "exchange-rate-risk", unitId: "C_FX_001", topic: "汇率风险 · 汇率风险定义",
    answer: "汇率风险需要结合币种和净头寸方向判断。例如企业未来收取美元且没有同币种支出，如果本币升值，美元收入兑换得到的本币减少，因此要核实现金流日期与对冲安排。",
  },
  {
    topicId: "economic-cycle-risk", unitId: "M_BC_003", topic: "经济周期风险 · 信贷与融资顺周期",
    answer: "信贷与融资条件可能放大周期波动。例如需求下降导致企业盈利减少，银行因信用风险收缩贷款，融资减少又影响投资，因此要检查借款人的现金流和可替代融资。",
  },
  {
    topicId: "interest-rate-risk", unitId: "M_IR_004", topic: "利率风险 · 期权风险",
    answer: "利率变化可能改变客户提前还款或提前支取的行为。例如利率下降后借款人可以重新融资，原贷款提前收回，银行未来收入因此改变；判断时要核对合同中的提前还款条件。",
  },
  {
    topicId: "inflation-risk", unitId: "M_INF_003", topic: "通货膨胀风险 · 预期与合同调整",
    answer: "通胀预期会影响合同定价，但固定名义合同与指数化合同的影响不同。例如固定租金不会自动随物价增加，因此需要核对调整条款、调整周期和采用的指数。",
  },
  {
    topicId: "policy-risk", unitId: "M_POL_004", topic: "政策风险 · 产业/贸易政策渠道",
    answer: "贸易政策会通过投入成本和销售市场影响企业。例如进口关税提高可能增加下游成本，如果企业能更换供应商，影响就会变化，因此要检查政策对象、实施时间及替代渠道。",
  },
] as const;

async function createSelectedSession(page: Page, subject: typeof subjects[number]) {
  const registered = await page.request.post("/api/auth/register", { data: {
    name: "知识问答测试学生", email: `knowledge-qa-${crypto.randomUUID()}@example.test`, password: "Knowledge-qa-password-2026!",
  } });
  expect(registered.status()).toBe(201);
  const created = await page.request.post("/api/sessions", { data: {
    knowledgeSelection: { topicId: subject.topicId, unitId: subject.unitId },
    topic: "由知识目录提供", objective: "由知识目录提供学习目标", learnerLevel: "有基础", clientRequestId: crypto.randomUUID(),
  } });
  expect(created.status()).toBe(201);
  const session = sessionEnvelopeSchema.parse(await created.json()).data.session;
  expect(session.topic).toBe(subject.topic);
  return session;
}

function answerAt(subject: typeof subjects[number], index: number) {
  return `${subject.answer}这是第${index + 1}次独立作答，我会把具体条件、传导过程与结果分别说明，并核实案例证据。`;
}

test.beforeEach(() => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE === "true", "These student workflows exercise ordinary learning with draft reference retrieval disabled.");
});

for (const subject of subjects) {
  test(`${subject.topicId} completes diagnosis, questions, explanation, report, and focused retry`, async ({ page }) => {
    const session = await createSelectedSession(page, subject);
    await page.goto(`/session/${session.id}`);
    await expect(page.locator(".learning-record-heading").getByText("认知诊断")).toBeVisible();
    for (let index = 0; index < 5; index += 1) {
      await page.getByLabel("独立作答").fill(answerAt(subject, index));
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST" && response.ok()),
        page.getByRole("button", { name: "提交回答" }).click(),
      ]);
      await expect(page.getByText(/正在分析学习证据/)).toHaveCount(0);
      if (index === 0) {
        await expect(page.locator(".learning-record-heading").getByText("苏格拉底追问")).toBeVisible();
        await page.reload();
        await expect(page.getByText(answerAt(subject, index), { exact: true })).toBeVisible();
      }
    }
    if (await page.getByRole("button", { name: "进入费曼阐释" }).isVisible()) {
      await page.getByRole("button", { name: "进入费曼阐释" }).click();
    }
    await expect(page.getByLabel("费曼阐释")).toBeVisible();
    await page.getByLabel("费曼阐释").fill(`${subject.topic}需要从具体条件解释。${subject.answer}如果换到另一个主体，必须重新核对暴露、合同和可替代安排，不能机械沿用原结论。`);
    await page.getByRole("button", { name: "生成学习报告" }).click();
    await expect(page).toHaveURL(`/report/${session.id}`);
    await expect(page.getByRole("heading", { name: subject.topic, exact: true })).toBeVisible();
    await expect(page.getByText("五维能力评估")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "开启定向巩固", exact: true }).click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.locator("main")).toHaveAttribute("data-parent-session-id", session.id);
    const retryId = page.url().split("/session/")[1];
    const retryResponse = await page.request.get(`/api/sessions/${retryId}`);
    expect(retryResponse.ok()).toBe(true);
    expect(sessionEnvelopeSchema.parse(await retryResponse.json()).data.session.topic).toBe(subject.topic);
  });
}

test("report retry reflects persisted gap status and only retries recoverable errors", async ({ page }) => {
  const subject = subjects[0];
  const original = await createSelectedSession(page, subject);
  let phase = original.phase;
  for (let index = 0; index < 5; index += 1) {
    const answer = await page.request.post(`/api/sessions/${original.id}/answers`, { data: { answer: answerAt(subject, index), clientRequestId: crypto.randomUUID() } });
    expect(answer.ok()).toBe(true);
    phase = sessionEnvelopeSchema.parse(await answer.json()).data.session.phase;
  }
  if (phase === "SOCRATIC") {
    const entered = await page.request.post(`/api/sessions/${original.id}/feynman/enter`, { data: { clientRequestId: crypto.randomUUID() } });
    expect(entered.ok()).toBe(true);
  }
  const report = await page.request.post(`/api/sessions/${original.id}/feynman`, { data: { explanation: `${subject.topic}：${subject.answer}`, clientRequestId: crypto.randomUUID() } });
  expect(report.ok()).toBe(true);
  await page.goto(`/report/${original.id}`);
  await expect(page.getByRole("button", { name: "开启定向巩固", exact: true })).toBeEnabled();

  const requestIds: string[] = [];
  await page.route(`**/api/sessions/${original.id}/retry`, async (route) => {
    requestIds.push(retryRequestSchema.parse(route.request().postDataJSON()).clientRequestId);
    if (requestIds.length === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
        requestId: "retry-test-timeout", error: { code: "AI_TIMEOUT", message: "巩固生成暂时超时，请重试。", retryable: true },
      }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "开启定向巩固", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("巩固生成暂时超时，请重试。");
  await page.getByRole("button", { name: "重试创建", exact: true }).click();
  await expect(page).toHaveURL(/\/session\//);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[1]).toBe(requestIds[0]);

  await page.goto(`/report/${original.id}`);
  await expect(page.getByRole("button", { name: "开启定向巩固", exact: true })).toBeEnabled();
  // Another tab consumes the remaining OPEN gap after this report was loaded.
  const elsewhere = await page.request.post(`/api/sessions/${original.id}/retry`, { data: { clientRequestId: crypto.randomUUID() } });
  expect(elsewhere.status()).toBe(201);
  await page.getByRole("button", { name: "开启定向巩固", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("没有待修复的学习漏洞。");
  await expect(page.getByRole("button", { name: "重试创建", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开启定向巩固", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重新加载报告", exact: true }).click();
  await expect(page.getByRole("button", { name: "巩固已开始", exact: true })).toBeDisabled();
  await expect(page.getByText("这些要点已开始定向巩固，可在学习记录中继续。", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
