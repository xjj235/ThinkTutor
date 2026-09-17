import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import { knowledgeRuntimeSchema } from "../src/lib/knowledge/runtime-schemas";
import { buildV12Manifest } from "../src/lib/knowledge/v12-resources";
import type { TurnAssessment } from "../src/lib/knowledge/v12-schema";

const scenarios = [
  { id: "scope-only", dimension: "MECHANISM", answer: "系统性风险的研究对象是整个金融体系，不是单家银行的经营损失。目前我只说明了研究范围，还没有说明金融服务受到什么影响。", subject: /金融|服务|影响/u },
  { id: "payment-condition", dimension: "CONDITION", answer: "我关注金融体系的支付结算功能，而不是一家银行的损失。如果一家银行停办支付业务，影响经机构间联系扩散，使整个体系的支付结算不能正常进行，这才是我判断系统性风险的依据。单家银行经营失败并不足以支持这个判断。", subject: /支付|结算/u },
  { id: "credit-condition", dimension: "CONDITION", answer: "系统性风险针对金融体系，不能只看某个机构的盈亏。我以企业普遍无法获得信贷作为功能受损的表现，还要核实冲击在不同机构间的传播。单家银行倒闭不一定构成系统性风险，信贷服务能否正常提供才是我关注的依据。", subject: /信贷|融资/u },
] as const;

test("real model asks different evidence-bounded questions for different HTML answers", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_PREVIEW_GROUNDED_TEST !== "true", "Live model calls require explicit opt-in.");
  test.setTimeout(8 * 60_000);
  page.setDefaultTimeout(20_000);
  const base = new URL(process.env.PREVIEW_BASE_URL!);
  const database = new URL(process.env.PREVIEW_DATABASE_URL!);
  expect(["127.0.0.1", "localhost"]).toContain(base.hostname);
  expect(database.hostname).toBe("127.0.0.1");
  expect(database.pathname).toBe("/thinktutor_preview");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.href, max: 2 }) });
  const email = `live-grounded-${crypto.randomUUID()}@example.test`;
  const calls: number[] = [];
  const records: Array<{ scenario: string; answer: string; history: NonNullable<ReturnType<typeof knowledgeRuntimeSchema.parse>["v12"]>["coachingHistory"]; question: string; assessment: TurnAssessment | null; result: string | null }> = [];
  async function submit(name: string, endpoint: string, cost: number) {
    while (calls.filter((time) => Date.now() - time < 65_000).length + cost > 9) await page.waitForTimeout(5_000);
    for (let i = 0; i < cost; i++) calls.push(Date.now());
    const pending = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === "POST", { timeout: 150_000 });
    await page.getByRole("button", { name, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBeLessThan(300);
  }
  try {
    expect(await (await page.request.get("/api/health/ready")).text()).toContain('"aiProvider":"deepseek"');
    await page.goto("/register");
    await page.getByLabel("姓名").fill("动态追问检验");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(`Live-${crypto.randomUUID()}`);
    await page.getByRole("button", { name: "创建学生账号" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    for (const scenario of scenarios) {
      await page.goto("/learn/new");
      await page.getByRole("textbox", { name: "知识点" }).fill("系统性风险");
      await page.getByRole("textbox", { name: "学习目标" }).fill("解释金融体系功能损害与系统性风险判断的适用条件。");
      await page.getByLabel("学习者水平").selectOption("有基础");
      await submit("创建并开始学习", "/api/sessions", 1);
      await expect(page).toHaveURL(/\/session\//);
      const sessionId = page.url().split("/session/")[1];
      await submit("确认目标并开始", "/events", 1);
      await page.getByLabel("独立作答").fill(scenario.answer);
      await submit("提交回答", "/answers", 3);
      const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } });
      const runtime = knowledgeRuntimeSchema.parse(saved.knowledgeRuntime);
      const history = runtime.v12!.coachingHistory;
      const last = history.at(-1)!;
      const generated = last.followUp;
      // Failed semantic expectations must still retain the actual model evidence and decision.
      records.push({ scenario: scenario.id, answer: scenario.answer, history, question: generated?.question ?? "", assessment: runtime.v12!.assessments[runtime.v12!.lastAssessmentMessageId ?? ""] ?? null, result: runtime.v12!.lastResult });
      const basis = last.decisionBasis!;
      expect(basis.policyVersion).toBe("1.2");
      expect(basis.contentHash).toBe(runtime.versions.contentHash);
      expect(basis.assessment?.confidence).toBe(records.at(-1)!.assessment!.modelAssessmentConfidence);
      expect(basis.assessment?.result).toBe(runtime.v12!.lastResult);
      expect(basis.assessedTargetId).toBe("C_SR_001");
      expect(basis.assessedStage).toBe("DIAGNOSIS");
      expect(basis.selectedRuleId).toBe(runtime.v12!.lastResult === "NEED_VERIFY" && !basis.assessment?.supportedGap ? "COACH_VERIFY_EVIDENCE" : "COACH_FILL_GAP");
      if (basis.assessment?.supportedGap) {
        expect(basis.assessment.confidence).toBeLessThan(basis.assessment.minimumConfidence);
        expect(basis.assessment.supportedGap.confidence).toBeGreaterThanOrEqual(basis.assessment.minimumConfidence);
        expect(basis.matchedRuleIds).toContain(basis.assessment.supportedGap.ruleId);
        expect(runtime.v12!.lastResult).toBe("NEED_VERIFY");
        expect(runtime.v12!.unitStates.C_SR_001.status).not.toBe("MASTERED");
        expect(runtime.v12!.unitStates.C_SR_001.independentEvidenceCount).toBe(0);
        await expect(page.getByText("当前回答可支持针对缺项继续追问", { exact: false })).toBeVisible();
      }
      expect(basis.reason).toContain("追问维度");
      expect(basis.questionRequirements).toEqual(runtime.v12!.coachingPrompt!.rule);
      expect(basis.evidence.length).toBeGreaterThan(0);
      for (const ref of basis.evidence) {
        expect(ref.messageId).toBe(basis.basisMessageId);
        expect(scenario.answer.slice(ref.startOffset, ref.endOffset)).toBe(ref.extractedText);
      }
      if (last.profile.dimension === "CONDITION") expect(basis.matchedRuleIds).toContain("VERIFY_SYSTEMIC_CONDITION");
      expect(generated, "A template selection alone is not an adaptive followup.").toBeDefined();
      expect.soft(last.profile.dimension, `Semantic calibration: ${scenario.id}`).toBe(scenario.dimension);
      expect(scenario.answer).toContain(generated!.studentAnchor);
      expect(generated!.question).toContain(generated!.studentAnchor);
      expect(generated!.question).toMatch(scenario.subject);
      expect((generated!.question.match(/[?？]/gu) ?? []).length).toBe(1);
      expect(runtime.v12!.coachingPrompt?.text).toBe(generated!.question);
      if (scenario.dimension === "CONDITION") expect.soft(runtime.v12!.coachingPrompt?.rule.requiredAll, `Semantic calibration scope: ${scenario.id}`).toEqual(["condition_revision"]);
      for (const form of buildV12Manifest().v12!.coachingPolicy!.forms) {
        expect(generated!.question).not.toContain(form.template.replace("{target}", "系统性风险"));
      }
      await expect(page.getByText(generated!.question, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const usage = await prisma.aIUsage.findMany({ where: { requestId: { in: [last.requestId, `${last.requestId}:review`] }, status: "SUCCESS" } });
      expect(usage.map((u) => u.operation)).toEqual(expect.arrayContaining(["teaching_selection", "teaching_review"]));
      expect(usage.every((u) => u.provider === "deepseek" && (u.promptTokens ?? 0) > 0 && (u.completionTokens ?? 0) > 0)).toBe(true);
      console.log(JSON.stringify({ scenario: scenario.id, dimension: last.profile.dimension, question: generated!.question, model: usage[0]?.model }));
      await page.screenshot({ path: testInfo.outputPath(`${scenario.id}.png`), fullPage: true });
    }
    expect(new Set(records.map((r) => r.question)).size).toBe(scenarios.length);
  } finally {
    const path = testInfo.outputPath("grounded-followup-evidence.json");
    await writeFile(path, JSON.stringify(records, null, 2), "utf8");
    await testInfo.attach("grounded-followup-evidence", { path, contentType: "application/json" });
    try { await prisma.user.deleteMany({ where: { email, role: "STUDENT" } }); }
    finally { await prisma.$disconnect(); }
  }
});
