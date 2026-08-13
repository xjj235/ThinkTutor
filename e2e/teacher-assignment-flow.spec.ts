import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const password = "Secure-e2e-password-2026";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ allowExitOnIdle: true, connectionString: process.env.DATABASE_URL, max: 4 }),
});
type Entity = { id: string };
type Classroom = Entity & { joinCode: string };

async function data<T>(response: import("@playwright/test").APIResponse): Promise<T> {
  if (!response.ok()) throw new Error(`Request failed (${response.status()}): ${await response.text()}`);
  return ((await response.json()) as { data: T }).data;
}

test.afterAll(async () => prisma.$disconnect());

test("teacher publishes an assignment, student completes it, and teacher sees the report", async ({ page, request, baseURL }) => {
  const teacher = await prisma.user.create({ data: { email: `teacher-flow-${crypto.randomUUID()}@example.test`, name: "任务教师", passwordHash: await hash(password), role: "TEACHER" } });
  await request.post("/api/auth/login", { data: { email: teacher.email, password } });
  const course = await data<Entity>(await request.post("/api/courses", { data: { title: "论证与证据" } }));
  const chapter = await data<Entity>(await request.post(`/api/courses/${course.id}/chapters`, { data: { title: "证据判断", sortOrder: 1 } }));
  const goal = await data<Entity>(await request.post(`/api/chapters/${chapter.id}/goals`, { data: { title: "建立证据链", objective: "能够说明主张、证据和推理之间的可验证关系。", sortOrder: 1 } }));
  const classroom = await data<Classroom>(await request.post("/api/classes", { data: { courseId: course.id, name: "论证学习班" } }));

  const studentContext = await import("@playwright/test").then(({ request: requestFactory }) => requestFactory.newContext({ baseURL }));
  const studentEmail = `student-flow-${crypto.randomUUID()}@example.test`;
  await data<Entity>(await studentContext.post("/api/auth/register", { data: { name: "任务学生", email: studentEmail, password } }));
  await data<Entity>(await studentContext.post(`/api/classes/${classroom.id}/join`, { data: { joinCode: classroom.joinCode } }));

  const assignment = await data<Entity>(await request.post("/api/assignments", { data: { classroomId: classroom.id, courseId: course.id, chapterId: chapter.id, learningGoalId: goal.id, title: "证据链费曼讲解", instructions: "用自己的话解释一条主张如何由证据与推理支持。", learnerLevel: "入门", maxAttempts: 1 } }));
  await data<Entity>(await request.post(`/api/assignments/${assignment.id}/publish`, { data: {} }));

  const started = await data<{session:{id:string}}>(await studentContext.post("/api/sessions", { data: { assignmentId: assignment.id, topic: "由教师任务提供", objective: "由教师任务提供", learnerLevel: "由教师任务提供" } }));
  const sessionId = started.session.id;
  const marker = crypto.randomUUID();
  const answers = [
    "我认为证据链把一个可检验的主张与观察事实连接起来。",
    "关键概念是证据是否与主张相关，并且能够排除其他解释。",
    "因为孤立事实不能自动推出结论，所以需要说明中间推理关系。",
    "这条判断的证据可以是可复核数据，并要说明数据如何支持结论。",
  ];
  for (const [index, answer] of answers.entries()) {
    await data(await studentContext.post(`/api/sessions/${sessionId}/answers`, { data: { answer, clientRequestId: `${marker}-answer-${index}` } }));
  }
  await data(await studentContext.post(`/api/sessions/${sessionId}/feynman/enter`, { data: { clientRequestId: `${marker}-enter` } }));
  await data(await studentContext.post(`/api/sessions/${sessionId}/feynman`, { data: { explanation: "一条可靠证据链先提出可以检验的主张，再给出与主张相关且可复核的证据，然后解释证据为什么支持结论。例如判断一种学习方法有效，要比较数据并排除时间投入差异。如果迁移到新闻核查，也要检查来源与替代解释。", clientRequestId: `${marker}-feynman` } }));

  await page.goto("/login");
  await page.getByLabel("邮箱").fill(teacher.email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/teacher/);
  await page.goto(`/teacher/assignments/${assignment.id}`);
  await expect(page.getByText("任务学生")).toBeVisible();
  await expect(page.getByRole("link", { name: /查看报告/ })).toHaveAttribute("href", `/report/${sessionId}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await studentContext.dispose();
});
