import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, allowExitOnIdle: true, max: 4 }) });
test.afterAll(async () => prisma.$disconnect());

test("a completed retry shows its review and reopens an unverified source gap for continued practice", async ({ page }) => {
  const password = "Secure-retry-review-2026";
  const student = await prisma.user.create({ data: { email: `retry-${crypto.randomUUID()}@example.test`, name: "定向巩固学生", passwordHash: await hash(password), role: "STUDENT" } });
  const original = await prisma.learningSession.create({ data: {
    userId: student.id, topic: "金融风险传导", objective: "分析条件与风险传播", learnerLevel: "有基础", phase: "COMPLETED",
    report: { create: { summary: "需继续验证条件变化", overallScore: 50, overallLevel: "形成性评价", disclaimer: "此记录用于测试学习流程",
      dimensions: { create: (["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"] as const).map((key) => ({ key, score: 50, evidence: "测试记录中的边界说明不足", feedback: "补充条件变化分析" })) },
      gaps: { create: { title: "传播条件尚未验证", evidence: "尚未分析共同敞口消失后的情况", repairTask: "解释共同持仓与抛售的联系，并比较条件变化。", priority: 5 } },
    } },
  }, include: { report: { include: { gaps: true } } } });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(student.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto(`/report/${original.id}`);
  await page.getByRole("button", { name: "开启定向巩固" }).click();
  await expect(page).toHaveURL(/\/session\//);
  const retryId = page.url().split("/session/")[1];
  for (let i = 0; i < 6; i++) {
    if (await page.getByLabel("费曼阐释", { exact: true }).count()) break;
    await page.getByLabel("独立作答", { exact: true }).fill(`机构之间存在共同资产敞口，因为价格下跌会传染损失。如果流动性下降，会导致共同持仓抛售，例如保证金追缴进一步放大损失。第${i}轮。`);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST" && response.ok()),
      page.getByRole("button", { name: "提交回答", exact: true }).click(),
    ]);
    await expect(page.getByText(/正在分析学习证据/)).toHaveCount(0);
  }
  await page.getByLabel("费曼阐释", { exact: true }).fill("共同资产价格下跌可能让多个机构受损。例如流动性压力迫使一家银行抛售资产，其他共同持仓机构也可能出现亏损。如果没有共同敞口，还应检查其他传播条件。");
  await page.getByRole("button", { name: "生成学习报告", exact: true }).click();
  await expect(page).toHaveURL(`/report/${retryId}`);
  await expect(page.getByRole("heading", { name: "本次定向巩固复核" })).toBeVisible();
  await expect(page.getByText("原要点仍需巩固", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "本次定向巩固复核" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const sourceGap = await prisma.learningGap.findUniqueOrThrow({ where: { id: original.report!.gaps[0].id } });
  expect(sourceGap.status).toBe("OPEN");
  expect(sourceGap.resolvedAt).toBeNull();
  await page.getByRole("link", { name: "查看原要点与继续巩固" }).click();
  await expect(page).toHaveURL(`/report/${original.id}`);
  await expect(page.getByRole("link", { name: "查看最近巩固报告" })).toHaveAttribute("href", `/report/${retryId}`);
  await page.getByRole("button", { name: "开启定向巩固" }).click();
  await expect(page).toHaveURL(/\/session\//);
  const nextId = page.url().split("/session/")[1];
  expect(nextId).not.toBe(retryId);
  await page.goto(`/report/${original.id}`);
  await page.getByRole("link", { name: "继续本次巩固" }).click();
  await expect(page).toHaveURL(`/session/${nextId}`);
});
