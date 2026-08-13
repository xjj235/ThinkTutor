import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSession, readSession, saveMessage } from "@/lib/session-data-service";
import { createTestUser } from "../factories";

const task = {
  course: "金融学导论",
  chapter: "风险",
  topic: "系统性风险",
  objective: "理解风险传导",
  learnerLevel: "有基础",
  referenceText: "局部风险可能通过机构关联扩散。",
};

describe("session data service on PostgreSQL", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it("creates and reads a session with its relations", async () => {
    const user = await createTestUser("data-read");
    const created = await createSession({ ...task, userId: user.id });
    const loaded = await readSession(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.topic).toBe(task.topic);
    expect(loaded?.phase).toBe("DIAGNOSIS");
    expect(loaded?.messages).toEqual([]);
    expect(loaded?.report).toBeNull();
  });

  it("stores a globally unique client request only once", async () => {
    const user = await createTestUser("idempotency");
    const firstSession = await createSession({ ...task, userId: user.id });
    const secondSession = await createSession({ ...task, topic: "流动性风险", userId: user.id });
    const input = { sessionId: firstSession.id, role: "USER" as const, phase: "DIAGNOSIS" as const, content: "风险从局部扩散到整体。", clientRequestId: "request-0001" };
    const first = await saveMessage(input);
    const second = await saveMessage({ ...input, content: "重复请求不得覆盖原消息。" });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.message.content).toBe(input.content);
    await expect(saveMessage({ ...input, sessionId: secondSession.id })).rejects.toThrow("globally unique");
  });

  it("cascades parent deletion through retry data and normalized reports", async () => {
    const user = await createTestUser("cascade");
    const parent = await createSession({ ...task, userId: user.id });
    const child = await prisma.learningSession.create({ data: { ...task, userId: user.id, parentSessionId: parent.id, source: "RETRY" } });
    await saveMessage({ sessionId: child.id, role: "USER", phase: "DIAGNOSIS", content: "级联消息。", clientRequestId: "request-0002" });
    await prisma.learningReport.create({
      data: {
        sessionId: child.id,
        summary: "测试报告",
        overallScore: 80,
        overallLevel: "发展中",
        disclaimer: "测试免责声明",
        dimensions: { create: ["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"].map((key) => ({ key: key as "CONCEPT_COMPLETENESS", score: 80, evidence: "对话证据", feedback: "继续练习" })) },
        strengths: { create: [{ title: "已掌握", evidence: "对话证据", position: 0 }] },
        gaps: { create: [{ title: "待改进", evidence: "对话证据", repairTask: "继续练习", priority: 5 }] },
        nextSteps: { create: [{ description: "继续练习", position: 0 }] },
      },
    });
    await prisma.learningSession.delete({ where: { id: parent.id } });
    expect(await prisma.learningSession.count({ where: { id: child.id } })).toBe(0);
    expect(await prisma.message.count({ where: { sessionId: child.id } })).toBe(0);
    expect(await prisma.learningReport.count({ where: { sessionId: child.id } })).toBe(0);
  });
});
