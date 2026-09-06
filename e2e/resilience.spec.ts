import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

const task = {
  course: "金融学导论",
  chapter: "风险与金融稳定",
  topic: "系统性风险",
  objective: "理解局部冲击如何扩散为整体风险",
  learnerLevel: "有基础",
  referenceText: "系统性风险通过关联、杠杆和流动性渠道传导。",
};

const sessionEnvelopeSchema = z.object({
  requestId: z.string(),
  data: z.object({
    session: z.object({
      id: z.string(),
      phase: z.enum(["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "REPORTING", "COMPLETED", "ABANDONED"]),
    }),
    messages: z.array(
      z.object({
        content: z.string(),
        clientRequestId: z.string().nullable(),
      }),
    ),
    duplicate: z.boolean().optional(),
  }),
});

const answerRequestSchema = z.object({
  answer: z.string(),
  clientRequestId: z.string(),
});

async function createSession(request: APIRequestContext) {
  const response = await request.post("/api/sessions", { data: { ...task, clientRequestId: `e2e-create-${crypto.randomUUID()}` } });
  expect(response.status()).toBe(201);
  return sessionEnvelopeSchema.parse(await response.json()).data;
}

async function registerWithApi(request: APIRequestContext, label: string) {
  const response = await request.post("/api/auth/register", { data: { name: "韧性测试学生", email: `${label}-${crypto.randomUUID()}@example.test`, password: "Secure-e2e-password-2026" } });
  expect(response.status()).toBe(201);
}

async function registerThroughUi(page: Page) {
  await page.goto("/register");
  await page.getByLabel("姓名").fill("浏览器测试学生");
  await page.getByLabel("邮箱").fill(`browser-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Secure-e2e-password-2026");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function createSessionThroughUi(page: Page) {
  await registerThroughUi(page);
  await page.goto("/learn/new");
  await page.getByLabel("课程（可选）").fill(task.course);
  await page.getByLabel("章节（可选）").fill(task.chapter);
  await page.getByLabel("知识点").fill(task.topic);
  await page.getByLabel("学习目标").fill(task.objective);
  await page.getByLabel("学习者水平").selectOption(task.learnerLevel);
  await page
    .getByLabel("教师或课程参考材料（可选）")
    .fill(task.referenceText);
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  return page.url().split("/session/")[1] ?? "";
}

test("a retryable answer error keeps persisted state and reuses the request id", async ({ page }) => {
  const sessionId = await createSessionThroughUi(page);
  const observedRequestIds: string[] = [];

  await page.route("**/api/sessions/*/answers", async (route) => {
    const body = answerRequestSchema.parse(route.request().postDataJSON());
    observedRequestIds.push(body.clientRequestId);

    if (observedRequestIds.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: "AI_TIMEOUT",
            message: "模拟模型超时，请重试。",
            retryable: true,
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  await page
    .getByLabel("独立作答")
    .fill("系统性风险会通过机构之间的联系扩散到整体市场。");
  await page.getByRole("button", { name: "提交回答" }).click();
  await expect(
    page.getByText("模拟模型超时，请重试。", { exact: true }),
  ).toBeVisible();

  const afterFailureResponse = await page.request.get(`/api/sessions/${sessionId}`);
  const afterFailure = sessionEnvelopeSchema.parse(
    await afterFailureResponse.json(),
  ).data;
  expect(afterFailure.session.phase).toBe("DIAGNOSIS");
  expect(afterFailure.messages).toHaveLength(1);

  await page.getByRole("button", { name: "重试本次操作" }).click();
  await expect(page.locator(".learning-record-heading").getByText("苏格拉底追问")).toBeVisible();
  expect(observedRequestIds).toHaveLength(2);
  expect(observedRequestIds[1]).toBe(observedRequestIds[0]);

  const afterRetryResponse = await page.request.get(`/api/sessions/${sessionId}`);
  const afterRetry = sessionEnvelopeSchema.parse(
    await afterRetryResponse.json(),
  ).data;
  expect(afterRetry.session.phase).toBe("SOCRATIC");
  expect(
    afterRetry.messages.filter(
      (message) => message.clientRequestId === observedRequestIds[0],
    ),
  ).toHaveLength(1);
});

test("repeated HTTP requests do not create duplicate messages", async ({
  request,
}, testInfo) => {
  await registerWithApi(request, `duplicate-${testInfo.project.name}`);
  const created = await createSession(request);
  const clientRequestId = `playwright-duplicate-${testInfo.project.name}`;
  const data = {
    answer: "系统性风险会通过共同资产和流动性渠道扩散。",
    clientRequestId,
  };

  const firstResponse = await request.post(
    `/api/sessions/${created.session.id}/answers`,
    { data },
  );
  expect(firstResponse.status()).toBe(200);
  const first = sessionEnvelopeSchema.parse(await firstResponse.json()).data;
  expect(first.duplicate).toBe(false);

  const duplicateResponse = await request.post(
    `/api/sessions/${created.session.id}/answers`,
    { data },
  );
  expect(duplicateResponse.status()).toBe(200);
  const duplicate = sessionEnvelopeSchema.parse(
    await duplicateResponse.json(),
  ).data;
  expect(duplicate.duplicate).toBe(true);
  expect(duplicate.messages).toHaveLength(first.messages.length);

  const loadedResponse = await request.get(
    `/api/sessions/${created.session.id}`,
  );
  const loaded = sessionEnvelopeSchema.parse(await loadedResponse.json()).data;
  expect(
    loaded.messages.filter(
      (message) => message.clientRequestId === clientRequestId,
    ),
  ).toHaveLength(1);
});

test("key pages expose labels and fit the configured viewport", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "创建学生账号" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await registerThroughUi(page);
  await page.goto("/learn/new");
  await expect(page.getByLabel("知识点")).toBeVisible();
  await expect(page.getByLabel("学习目标")).toBeVisible();
  await expect(page.getByLabel("学习者水平")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
