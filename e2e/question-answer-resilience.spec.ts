import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const envelopeSchema = z.object({
  data: z.object({
    session: z.object({
      id: z.string(),
      phase: z.enum(["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "REPORTING", "COMPLETED", "ABANDONED"]),
      socraticTurns: z.number(),
    }),
    messages: z.array(z.object({ id: z.string(), role: z.string(), content: z.string(), clientRequestId: z.string().nullable() })),
  }),
});
const answerSchema = z.object({ answer: z.string(), clientRequestId: z.string() });
const explanationSchema = z.object({ explanation: z.string(), clientRequestId: z.string() });
const eventSchema = z.object({ action: z.enum(["GOAL_CONFIRMED", "SESSION_RESUMED"]), clientRequestId: z.string() });
const createSchema = z.object({
  topic: z.string(), objective: z.string(), clientRequestId: z.string(),
  knowledgeSelection: z.object({ topicId: z.string(), unitId: z.string().optional() }).optional(),
});
const originalAnswer = "我先确认企业持有外币应收款，再比较兑换成本币的金额变化；如果本币升值，同一笔外币收入兑换的本币金额会减少。";
const uncertainMessage = "暂时无法确认操作结果，原内容已保留。请重试本次操作，确认完成后再继续。";

async function register(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    data: { name: "问答恢复测试学生", email: `qa-resilience-${crypto.randomUUID()}@example.test`, password: "Question-recovery-e2e-2026!" },
  });
  expect(response.status()).toBe(201);
}

async function createSession(page: Page, curated = false) {
  const response = await page.request.post("/api/sessions", {
    data: {
      topic: curated ? "系统性风险" : "汇率风险",
      objective: curated ? "解释风险如何沿金融机构关联传播。" : "明确外币头寸并解释汇率变化后的损益方向。",
      learnerLevel: "有基础",
      ...(curated ? {} : { knowledgeSelection: { topicId: "exchange-rate-risk", unitId: "M_FX_001" } }),
      clientRequestId: `create-${crypto.randomUUID()}`,
    },
  });
  expect(response.status()).toBe(201);
  return envelopeSchema.parse(await response.json()).data;
}

async function readSession(page: Page, id: string) {
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return envelopeSchema.parse(await response.json()).data;
}

async function prepareTaskForm(page: Page) {
  await page.goto("/learn/new");
  await page.getByLabel("风险主题", { exact: true }).selectOption("exchange-rate-risk");
  await page.getByLabel("知识库单元", { exact: true }).selectOption("M_FX_001");
  await page.getByLabel("学习者水平").selectOption("有基础");
}

for (const failureMode of ["disconnect", "server-error"] as const) {
test(`a committed answer with ${failureMode} locks edits and recovers the same request`, async ({ page }) => {
  await register(page);
  const created = await createSession(page);
  await page.goto(`/session/${created.session.id}`);
  const requests: Array<z.infer<typeof answerSchema>> = [];
  await page.route("**/api/sessions/*/answers", async (route) => {
    requests.push(answerSchema.parse(route.request().postDataJSON()));
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (failureMode === "server-error") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用。", retryable: false } }) });
      } else {
        await route.abort("failed");
      }
      return;
    }
    await route.continue();
  });

  await page.getByLabel("独立作答").fill(originalAnswer);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(uncertainMessage);
  await expect(page.getByLabel("独立作答")).toBeDisabled();
  await expect(page.getByLabel("独立作答")).toHaveValue(originalAnswer);
  await expect(page.getByRole("button", { name: "提交回答", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /申请提示|暂无可用提示/u })).toBeDisabled();
  const committed = await readSession(page, created.session.id);
  expect(committed.messages.filter((message) => message.clientRequestId === requests[0].clientRequestId)).toHaveLength(1);

  await page.getByRole("button", { name: "重试本次操作", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("独立作答")).toBeEnabled();
  await expect(page.getByLabel("独立作答")).toHaveValue("");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const recovered = await readSession(page, created.session.id);
  expect(recovered.messages.map((message) => message.id)).toEqual(committed.messages.map((message) => message.id));
  expect(recovered.session.socraticTurns).toBe(committed.session.socraticTurns);
});
}

test("a committed Feynman explanation with a lost response recovers its saved report", async ({ page }) => {
  await register(page);
  let state = await createSession(page);
  for (let index = 0; index < 8 && state.session.phase !== "FEYNMAN"; index++) {
    const response = await page.request.post(`/api/sessions/${state.session.id}/answers`, {
      data: { answer: `${originalAnswer}这是第${index + 1}轮对条件与后果的说明。`, clientRequestId: `answer-${crypto.randomUUID()}` },
    });
    expect(response.ok()).toBe(true);
    state = envelopeSchema.parse(await response.json()).data;
  }
  expect(state.session.phase).toBe("FEYNMAN");
  await page.goto(`/session/${state.session.id}`);
  const requests: Array<z.infer<typeof explanationSchema>> = [];
  await page.route("**/api/sessions/*/feynman", async (route) => {
    requests.push(explanationSchema.parse(route.request().postDataJSON()));
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const explanation = `${originalAnswer}相反，外币应付款在相同汇率方向下可能降低本币支出；因此需要先明确币种、收付方向、汇率报价方式及发生时间，再讨论风险。`;
  await page.getByLabel("费曼阐释", { exact: true }).fill(explanation);
  await page.getByRole("button", { name: "生成学习报告", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(uncertainMessage);
  await expect(page.getByLabel("费曼阐释", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("费曼阐释", { exact: true })).toHaveValue(explanation);
  const committed = await readSession(page, state.session.id);
  expect(committed.session.phase).toBe("COMPLETED");

  await page.getByRole("button", { name: "重试本次操作", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/report/${state.session.id}$`));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  const recovered = await readSession(page, state.session.id);
  expect(recovered.messages.map((message) => message.id)).toEqual(committed.messages.map((message) => message.id));
});

test("a committed task with a lost response retains its selection and ignores same-tick duplicate submits", async ({ page }) => {
  await register(page);
  await prepareTaskForm(page);
  const requests: Array<z.infer<typeof createSchema>> = [];
  let committedId = "";
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    requests.push(createSchema.parse(route.request().postDataJSON()));
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committedId = envelopeSchema.parse(await response.json()).data.session.id;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.locator("form.task-form").evaluate((form) => {
    if (!(form instanceof HTMLFormElement)) throw new Error("Missing task form");
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.locator("main").getByRole("alert")).toContainText("暂时无法确认任务是否创建");
  await expect(page.getByLabel("风险主题", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("知识库单元", { exact: true })).toHaveValue("M_FX_001");
  await expect(page.getByLabel("知识库单元", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("学习者水平")).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(committedId).not.toBe("");

  await page.getByRole("button", { name: "重试创建任务", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/session/${committedId}$`));
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("successful task creation stays locked while the next page is loading", async ({ page }) => {
  await register(page);
  await prepareTaskForm(page);
  let createRequests = 0;
  let navigationHeld = false;
  let releaseNavigation: () => void = () => {};
  const navigationGate = new Promise<void>((resolve) => { releaseNavigation = resolve; });
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") createRequests++;
    await route.continue();
  });
  await page.route("**/session/*", async (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/session/")) { await route.continue(); return; }
    navigationHeld = true;
    await navigationGate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "创建并开始学习", exact: true }).click();
    await expect.poll(() => navigationHeld).toBe(true);
    await expect(page.getByRole("button", { name: "正在创建...", exact: true })).toBeDisabled();
    await expect(page.getByLabel("风险主题", { exact: true })).toBeDisabled();
    await page.locator("form.task-form").evaluate((form) => {
      if (!(form instanceof HTMLFormElement)) throw new Error("Missing task form");
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(createRequests).toBe(1);
  } finally {
    releaseNavigation();
  }
  await expect(page).toHaveURL(/\/session\//);
  expect(createRequests).toBe(1);
});

test("curated knowledge goal and resume events retry their own action and request id after failures", async ({ page }) => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE !== "true", "Event recovery uses the explicitly enabled curated draft.");
  await register(page);
  const created = await createSession(page, true);
  await page.goto(`/session/${created.session.id}`);
  const events: Array<z.infer<typeof eventSchema>> = [];
  let answers = 0;
  await page.route("**/api/sessions/*/events", async (route) => {
    const body = eventSchema.parse(route.request().postDataJSON());
    events.push(body);
    if (events.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
      return;
    }
    if (body.action === "SESSION_RESUMED" && events.filter((event) => event.action === "SESSION_RESUMED").length === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_TIMEOUT", message: "恢复核验暂未开始，请重试。", retryable: true } }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "确认目标并开始", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(uncertainMessage);
  await expect(page.getByRole("button", { name: "确认目标并开始", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重试本次操作", exact: true }).click();
  await expect(page.getByLabel("独立作答")).toBeVisible();
  expect(events).toHaveLength(2);
  expect(events[1]).toEqual(events[0]);

  await page.route("**/api/sessions/*/answers", async (route) => {
    answers++;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_TIMEOUT", message: "本次回答尚未提交。", retryable: true } }) });
  });
  await page.getByLabel("独立作答").fill("系统性风险需要判断金融体系的功能是否受损。");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("本次回答尚未提交。");
  await page.getByRole("button", { name: "恢复核验", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("恢复核验暂未开始，请重试。");
  await page.getByRole("button", { name: "重试本次操作", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "恢复核验进行中" })).toBeVisible();
  expect(answers).toBe(1);
  expect(events).toHaveLength(4);
  expect(events[2].action).toBe("SESSION_RESUMED");
  expect(events[3]).toEqual(events[2]);
  expect(events[2].clientRequestId).not.toBe(events[0].clientRequestId);
});


for (const committed of [false, true]) {
  test(`a disconnected answer followed by a terminal error can sync authoritative progress (committed=${committed})`, async ({ page }) => {
    await register(page);
    const created = await createSession(page);
    await page.goto(`/session/${created.session.id}`);
    const requests: Array<z.infer<typeof answerSchema>> = [];
    await page.route("**/api/sessions/*/answers", async (route) => {
      requests.push(answerSchema.parse(route.request().postDataJSON()));
      if (requests.length === 1) {
        if (committed) expect((await route.fetch()).ok()).toBe(true);
        await route.abort("failed");
        return;
      }
      if (requests.length === 2) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "本次重试已被拒绝。", retryable: false } }) });
        return;
      }
      await route.continue();
    });
    await page.getByLabel("独立作答").fill(originalAnswer);
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(uncertainMessage);
    await page.getByRole("button", { name: "重试本次操作", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("本次重试已被拒绝。");
    await expect(page.getByLabel("独立作答")).toBeDisabled();
    expect(requests[1]).toEqual(requests[0]);

    let syncRequests = 0;
    await page.route(`**/api/sessions/${created.session.id}`, async (route) => {
      if (syncRequests++ === 0) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "本次同步暂时失败。", retryable: true } }) });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "同步最新进度", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("本次同步暂时失败。");
    await expect(page.getByLabel("独立作答")).toHaveValue(originalAnswer);
    await expect(page.getByLabel("独立作答")).toBeDisabled();
    await page.getByRole("button", { name: "同步最新进度", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("独立作答")).toBeEnabled();
    await expect(page.getByLabel("独立作答")).toHaveValue("");
    if (committed) {
      await expect(page.getByLabel("上次未确认的回答", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByLabel("上次未确认的回答", { exact: true })).toHaveValue(originalAnswer);
      await expect(page.getByLabel("上次未确认的回答", { exact: true })).toHaveAttribute("readonly", "");
    }
    const recovered = await readSession(page, created.session.id);
    expect(recovered.messages.filter((message) => message.clientRequestId === requests[0].clientRequestId)).toHaveLength(committed ? 1 : 0);

    const freshAnswer = "针对当前问题，我需要重新明确企业头寸与汇率方向，再说明风险来源。";
    await page.getByLabel("独立作答").fill(freshAnswer);
    await page.getByRole("button", { name: "提交回答", exact: true }).click();
    await expect(page.getByLabel("独立作答")).toHaveValue("");
    expect(requests).toHaveLength(3);
    expect(requests[2].clientRequestId).not.toBe(requests[0].clientRequestId);
    expect(requests[2].answer).toBe(freshAnswer);
  });
}

test("a failed load and an initial terminal answer error release their pending locks", async ({ page }) => {
  await register(page);
  const created = await createSession(page);
  let loads = 0;
  await page.route(`**/api/sessions/${created.session.id}`, async (route) => {
    if (loads++ === 0) { await route.abort("failed"); return; }
    await route.continue();
  });
  await page.goto(`/session/${created.session.id}`);
  await expect(page.getByRole("heading", { name: "无法读取学习会话", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByLabel("独立作答")).toBeEnabled();
  await page.route("**/api/sessions/*/answers", async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "请修改本次回答。", retryable: false } }) });
  });
  await page.getByLabel("独立作答").fill(originalAnswer);
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("请修改本次回答。");
  await expect(page.getByLabel("独立作答")).toBeEnabled();
  await page.getByLabel("独立作答").fill("修改后的回答保留正常编辑能力。");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("a disconnected task creation followed by a terminal error preserves content and offers recovery navigation", async ({ page }) => {
  await register(page);
  await prepareTaskForm(page);
  const requests: Array<z.infer<typeof createSchema>> = [];
  let committedId = "";
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    requests.push(createSchema.parse(route.request().postDataJSON()));
    if (requests.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committedId = envelopeSchema.parse(await response.json()).data.session.id;
      await route.abort("failed");
      return;
    }
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "本次创建重试已被拒绝。", retryable: false } }) });
  });
  await page.getByRole("button", { name: "创建并开始学习", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("暂时无法确认任务是否创建");
  await page.getByRole("button", { name: "重试创建任务", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("本次创建重试已被拒绝。");
  await expect(page.getByLabel("已输入的任务内容", { exact: true })).toHaveValue(new RegExp(requests[0].topic));
  await expect(page.getByLabel("已输入的任务内容", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "刷新任务页面", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试创建任务", exact: true })).toHaveCount(0);
  await page.locator("form.task-form").evaluate((form) => {
    if (!(form instanceof HTMLFormElement)) throw new Error("Missing task form");
    form.requestSubmit();
  });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  await page.getByRole("link", { name: "返回学习总览", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(`a[href="/session/${committedId}"]`).first()).toBeVisible();
});