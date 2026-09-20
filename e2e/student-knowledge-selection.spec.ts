import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Student-knowledge-selection-2026!";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true }),
});
const topics = [
  { id: "exchange-rate-risk", title: "汇率风险" },
  { id: "economic-cycle-risk", title: "经济周期风险" },
  { id: "interest-rate-risk", title: "利率风险" },
  { id: "inflation-risk", title: "通货膨胀风险" },
  { id: "policy-risk", title: "政策风险" },
];

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.afterAll(async () => prisma.$disconnect());

test("students choose all five risk topics and forty units, then complete a self-directed learning loop", async ({ page }, testInfo) => {
  test.skip(process.env.ALLOW_DRAFT_KNOWLEDGE === "true", "This flow verifies student selection while draft reference retrieval is disabled.");
  await page.goto("/register");
  await page.getByLabel("姓名").fill("知识点自学学生");
  await page.getByLabel("邮箱").fill(`student-knowledge-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建学生账号" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/learn/new");

  const topicPicker = page.getByLabel("风险主题", { exact: true });
  const unitPicker = page.getByLabel("知识库单元", { exact: true });
  const topicField = page.getByLabel("知识点");
  const objectiveField = page.locator("#objective");
  await expect(topicPicker.locator("option")).toHaveCount(6);
  await expect(unitPicker).toBeDisabled();
  await expect(page.getByText("按所选主题开展自主研习；配套资料待审核。", { exact: true })).toBeVisible();
  const selectedUnitIds = new Set<string>();

  for (const topic of topics) {
    await topicPicker.selectOption(topic.id);
    await expect(topicField).toHaveValue(topic.title);
    await expect(topicField).not.toBeEditable();
    await expect(objectiveField).not.toHaveValue("");
    await expect(objectiveField).not.toBeEditable();
    await expect(unitPicker).toHaveValue("");
    await expect(unitPicker.locator("option")).toHaveCount(9);
    const units = await unitPicker.locator("option").evaluateAll((options) => options
      .filter((option) => option instanceof HTMLOptionElement && option.value)
      .map((option) => ({ id: (option as HTMLOptionElement).value, title: option.textContent ?? "" })));
    for (const unit of units) {
      selectedUnitIds.add(unit.id);
      await unitPicker.selectOption(unit.id);
      await expect(topicField).toHaveValue(`${topic.title} · ${unit.title}`);
      await expect(objectiveField).not.toHaveValue("");
      await expectNoOverflow(page);
    }
  }
  expect(selectedUnitIds.size).toBe(40);

  const retainedTopic = await topicField.inputValue();
  const retainedObjective = await objectiveField.inputValue();
  await page.getByRole("button", { name: "改为自定义", exact: true }).click();
  await expect(topicPicker).toHaveValue("");
  await expect(unitPicker).toBeDisabled();
  await expect(topicField).toHaveValue(retainedTopic);
  await expect(objectiveField).toHaveValue(retainedObjective);
  await expect(topicField).toBeEditable();
  await expect(objectiveField).toBeEditable();
  await topicField.fill("自定义风险比较");
  await objectiveField.fill("比较不同风险在具体场景下的形成条件。");

  await topicPicker.selectOption("exchange-rate-risk");
  await unitPicker.selectOption({ index: 1 });
  const selectedUnitId = await unitPicker.inputValue();
  const selectedTopic = await topicField.inputValue();
  const selectedObjective = await objectiveField.inputValue();
  await page.getByLabel("学习者水平").selectOption("有基础");
  await page.screenshot({ path: testInfo.outputPath("student-knowledge-picker.png"), fullPage: true });
  const createRequest = page.waitForRequest((request) => request.url().endsWith("/api/sessions") && request.method() === "POST");
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    knowledgeSelection: { topicId: "exchange-rate-risk", unitId: selectedUnitId },
  });
  await expect(page).toHaveURL(/\/session\//);
  const sessionId = page.url().split("/session/")[1];
  const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } });
  expect(saved).toMatchObject({
    topic: selectedTopic,
    objective: selectedObjective,
    courseId: null,
    chapterId: null,
    learningGoalId: null,
    knowledgeRuntime: null,
    source: "SELF_DIRECTED",
  });
  await expect(page.locator(".learning-record-heading").getByText("认知诊断")).toBeVisible();
  await expectNoOverflow(page);
  await page.reload();

  const answers = [
    "汇率风险是汇率变化造成外币现金流折成本币后出现不确定性，例如未来收到美元的出口商可能承担本币升值带来的损失。",
    "关键是先确认企业有多少外币收入和支出，因为相同币种的支出可以抵消一部分收入敞口，所以不能只看合同金额。",
    "如果人民币升值而美元收入固定，那么兑换得到的人民币会减少，利润会受到影响；判断时还应检查是否有相同币种的成本。",
    "这个判断依赖收入币种、结算时间与套期保值安排，如果企业提前锁定汇率，实际结果可能不同，因此需要核对这些条件。",
    "我会比较未结算外币合同、同币种应付账款及套期保值记录，用实际净敞口检验是否仍有汇率风险。",
  ];
  for (const answer of answers) {
    await page.getByLabel("独立作答").fill(answer);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "POST" && response.ok()),
      page.getByRole("button", { name: "提交回答" }).click(),
    ]);
    await expect(page.getByText(/正在分析学习证据/)).toHaveCount(0);
  }
  await page.getByLabel("费曼阐释").fill(`${selectedTopic}的学习应从具体敞口开始。${answers.join("")}`);
  await page.getByRole("button", { name: "生成学习报告" }).click();
  await expect(page).toHaveURL(/\/report\//);
  await expect(page.getByRole("heading", { name: selectedTopic, exact: true })).toBeVisible();
  await expect(page.getByText("五维能力评估")).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "开启定向巩固" }).click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.locator("main")).toHaveAttribute("data-parent-session-id", sessionId);
  const retrySessionId = page.url().split("/session/")[1];
  const retrySession = await prisma.learningSession.findUniqueOrThrow({ where: { id: retrySessionId } });
  expect(retrySession.topic).toBe(selectedTopic);
  expect(retrySession.objective).not.toBe(selectedObjective);
});

test("student knowledge selection and an enrolled course goal clear each other's binding", async ({ page }) => {
  const suffix = crypto.randomUUID();
  const passwordHash = await hash(password);
  const [teacher, student] = await Promise.all([
    prisma.user.create({ data: { email: `knowledge-course-teacher-${suffix}@example.test`, name: "知识点教师", role: "TEACHER", passwordHash } }),
    prisma.user.create({ data: { email: `knowledge-course-student-${suffix}@example.test`, name: "知识点学生", role: "STUDENT", passwordHash } }),
  ]);
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "已发布的金融课程", status: "PUBLISHED" } });
  const chapter = await prisma.chapter.create({ data: { courseId: course.id, title: "课程风险章节", sortOrder: 1 } });
  const goal = await prisma.learningGoal.create({ data: { courseId: course.id, chapterId: chapter.id, title: "解释课程风险条件", objective: "结合课程中的案例说明风险发生的条件和影响。", sortOrder: 1 } });
  const classroom = await prisma.classroom.create({ data: { courseId: course.id, teacherId: teacher.id, name: "知识点选择测试班", joinCode: `K${suffix.replaceAll("-", "").slice(0, 7)}` } });
  await prisma.enrollment.create({ data: { classroomId: classroom.id, userId: student.id } });

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(student.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/learn/new");
  await page.getByLabel("风险主题", { exact: true }).selectOption("interest-rate-risk");
  await page.getByLabel("知识库单元", { exact: true }).selectOption({ index: 1 });
  await page.locator("#curriculum-course").selectOption(course.id);
  await expect(page.getByLabel("风险主题", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("知识库单元", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("知识点")).toHaveValue("");
  await expect(page.locator("#objective")).toHaveValue("");
  await page.locator("#curriculum-chapter").selectOption(chapter.id);
  await page.locator("#curriculum-goal").selectOption(goal.id);
  await expect(page.getByLabel("知识点")).toHaveValue(goal.title);
  await expect(page.locator("#objective")).toHaveValue(goal.objective);

  await page.getByLabel("风险主题", { exact: true }).selectOption("policy-risk");
  await expect(page.locator("#curriculum-course")).toHaveValue("");
  await expect(page.locator("#curriculum-chapter")).toHaveValue("");
  await expect(page.locator("#curriculum-goal")).toHaveValue("");
  await expect(page.locator("#curriculum-chapter")).toBeDisabled();
  await expect(page.locator("#curriculum-goal")).toBeDisabled();
  await expect(page.getByLabel("知识点")).toHaveValue("政策风险");
  const selectedObjective = await page.locator("#objective").inputValue();
  expect(selectedObjective).not.toBe(goal.objective);
  await page.getByLabel("学习者水平").selectOption("入门");
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "创建并开始学习" }).click();
  await expect(page).toHaveURL(/\/session\//);
  const sessionId = page.url().split("/session/")[1];
  expect(await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({
    topic: "政策风险",
    objective: selectedObjective,
    courseId: null,
    chapterId: null,
    learningGoalId: null,
    source: "SELF_DIRECTED",
  });
});
