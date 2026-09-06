import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@prisma/client";
import { buildV12Manifest } from "../src/lib/knowledge/v12-resources";
import { knowledgeRuntimeSchema } from "../src/lib/knowledge/runtime-schemas";
import { recordV12Action } from "../src/lib/knowledge/v12-engine";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true }) });
const manifest = buildV12Manifest();
test.afterAll(async () => prisma.$disconnect());
const answer = "首先，Systemic关注金融体系功能，Systematic关注不可分散的市场风险，二者研究对象不同。单家倒闭不等于系统性风险。例如初始冲击是房价下跌，没有直接借贷也可以通过共同持仓传播，多家机构同时受损。因为被迫抛售造成价格下跌和进一步损失，所以反馈放大引起金融功能受损。直接债权债务可传递违约损失。集中提款增加现金需求，被迫出售长期资产。负面信息造成预期变化，其他银行也出现提款并跨机构扩散。信贷收缩造成投资和就业下降。规模不是唯一因素，还有关联性和可替代性。个体自保形成同步行动与系统反馈。繁荣期杠杆上升形成风险累积，支付清算故障造成支付中断。最后，如果关键服务可替代，那么金融功能未受损时就不应判断为系统性事件。";

for (const c of manifest.cases) test(`v1.2 eight-case ${c.id}: complete, repair, retry and final explanation`, async ({ page }, testInfo) => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE !== "true", "Requires the isolated curated run");
  test.setTimeout(180_000);
  await page.goto("/register");
  await page.getByLabel("姓名").fill("案例工程回归");
  await page.getByLabel("邮箱").fill(`case-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill("Case-regression-2026!");
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  for (const scenario of ["complete", "repair"]) {
    const response = await page.request.post("/api/sessions", { data: { topic: "系统性风险", objective: "验证因果解释与条件变化", learnerLevel: "有基础", clientRequestId: crypto.randomUUID() } });
    expect(response.ok()).toBe(true);
    const id = (await response.json()).data.session.id;
    await page.goto(`/session/${id}`);
    await page.getByRole("button", { name: "确认目标并开始" }).click();
    await expect(page.getByLabel("独立作答")).toBeVisible();
    const row = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    let runtime = knowledgeRuntimeSchema.parse(row.knowledgeRuntime);
    for (const target of Object.keys(manifest.v12!.unitRules)) runtime.v12!.unitStates[target] = { status: "MASTERED", evidenceRefs: [], independentEvidenceCount: 2, verificationCount: 1, questionIds: ["fixture-1", "fixture-2"], lastUpdatedAt: new Date().toISOString() };
    runtime.v12!.pedagogicalStage = "CASE_TRANSFER";
    const content = `教学合成案例\n\n${c.studentText}\n\n${manifest.v12!.cases[c.id].studentQuestions}`;
    runtime = recordV12Action(runtime, { caseId: c.id, targetId: "COMP_SR_TRANSFER", questionId: `CASE_QUESTION_${c.id}`, groupId: "SQG_SR_010", questionType: "TRANSFER", hintLevel: 0, assistantMessage: content }, new Date().toISOString());
    // Test-owned database fixture, not a runtime selection or mastery bypass endpoint.
    await prisma.learningSession.update({ where: { id }, data: { phase: "SOCRATIC", socraticTurns: scenario === "complete" ? 2 : 0, knowledgeRuntime: runtime as unknown as Prisma.InputJsonValue, messages: { create: { role: "ASSISTANT", phase: "SOCRATIC", content, questionType: "TRANSFER" } } } });
    await page.reload();
    await expect(page.getByText(c.studentText, { exact: false }).last()).toBeVisible();
    async function submit(text: string) {
      await page.getByLabel("独立作答").fill(text);
      const pending = page.waitForResponse((r) => r.url().endsWith("/answers") && r.request().method() === "POST");
      await page.getByRole("button", { name: "提交回答" }).click();
      expect((await pending).ok()).toBe(true);
    }
    if (scenario === "repair") {
      await submit("本情境的初始冲击可能引发传播，但我尚不能解释放大环节与条件变化。");
      expect(knowledgeRuntimeSchema.parse((await prisma.learningSession.findUniqueOrThrow({ where: { id } })).knowledgeRuntime).v12!.transferPassed).toBe(false);
      await submit(`${answer}这是针对缺失步骤的独立修订。`);
      await expect(page.getByText(/教学合成案例/).last()).toBeVisible();
    }
    await submit(`${answer}这是最终新情境的完整判断。`);
    await expect(page.getByLabel("费曼阐释")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (c.id === "CASE_SR_001") await page.screenshot({ path: testInfo.outputPath(`${scenario}-case.png`), fullPage: true });
    await page.getByLabel("费曼阐释").fill(`${answer}这是面向初学者的独立阐释。`);
    await page.getByRole("button", { name: "提交讲解", exact: true }).click();
    await expect(page.getByLabel("反思修订")).toBeVisible();
    await page.getByLabel("反思修订").fill(`${answer}这是核验条件后的最终修订。`);
    await page.getByRole("button", { name: "提交修订并生成报告" }).click();
    await expect(page).toHaveURL(new RegExp(`/report/${id}$`));
    await expect(page.getByText("五维能力评估", { exact: true })).toBeVisible();
    await page.getByText("查看评分原文", { exact: true }).first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
