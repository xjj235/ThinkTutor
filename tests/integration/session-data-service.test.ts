import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createSession, readSession, saveMessage } from "@/lib/session-data-service";
import { getReportPayload } from "@/lib/session-service";
import { serializePayload, sessionRelations } from "@/lib/serializers";
import { createTestUser } from "../factories";

const task = {
  course: "金融学导论",
  chapter: "风险",
  topic: "系统性风险",
  objective: "理解风险传导",
  learnerLevel: "有基础",
  referenceText: "局部风险可能通过机构关联扩散。",
};

const createdUserIds: string[] = [];
async function createDataServiceUser(label: string) {
  const user = await createTestUser(label);
  createdUserIds.push(user.id);
  return user;
}

describe("session data service on PostgreSQL", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates and reads a session with its relations", async () => {
    const user = await createDataServiceUser("data-read");
    const created = await createSession({ ...task, userId: user.id });
    const reports = vi.spyOn(prisma.learningReport, "findUnique");
    const sessions = vi.spyOn(prisma.learningSession, "findUnique");
    const loaded = await readSession(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.topic).toBe(task.topic);
    expect(loaded?.phase).toBe("DIAGNOSIS");
    expect(loaded?.messages).toEqual([]);
    expect(loaded?.report).toBeNull();
    expect(reports).not.toHaveBeenCalled();
    expect(sessions).toHaveBeenCalledWith({
      where: { id: created.id },
      include: { messages: sessionRelations.messages, report: { select: { id: true } } },
    });
  });

  it("preserves saved report relations and fresh retry links for historical session phases", async () => {
    const user = await createDataServiceUser("data-report-history");
    const session = await createSession({ ...task, userId: user.id });
    await saveMessage({ sessionId: session.id, role: "USER", phase: "DIAGNOSIS", content: "我需要继续核查风险传播条件。" });
    const report = await prisma.learningReport.create({
      data: {
        sessionId: session.id, summary: "保留的历史报告", overallScore: 60, overallLevel: "发展中", disclaimer: "形成性反馈",
        dimensions: { create: (["CONCEPT_COMPLETENESS", "LOGIC_COMPLETENESS", "EXPRESSION_CLARITY", "EXAMPLE_ABILITY", "TRANSFER_ABILITY"] as const).map((key) => ({ key, score: 60, evidence: "学生原文证据", feedback: "继续核查条件" })) },
        strengths: { create: [{ title: "后项", evidence: "证据二", position: 1 }, { title: "前项", evidence: "证据一", position: 0 }] },
        gaps: { create: [{ title: "次要缺项", evidence: "证据一", repairTask: "检查条件", priority: 2 }, { title: "优先缺项", evidence: "证据二", repairTask: "比较新案例", priority: 5 }] },
        nextSteps: { create: [{ description: "后做", position: 1 }, { description: "先做", position: 0 }] },
      },
      include: { gaps: { orderBy: { priority: "desc" } } },
    });
    const gap = report.gaps[0];
    await prisma.learningSession.create({ data: { ...task, userId: user.id, parentSessionId: session.id, sourceGapId: gap.id, source: "RETRY", createdAt: new Date("2026-01-01T00:00:00Z") } });
    const latest = await prisma.learningSession.create({ data: { ...task, userId: user.id, parentSessionId: session.id, sourceGapId: gap.id, source: "RETRY", createdAt: new Date("2026-01-02T00:00:00Z") } });
    const original = await prisma.learningSession.findUniqueOrThrow({ where: { id: session.id }, include: sessionRelations });
    const reports = vi.spyOn(prisma.learningReport, "findUnique");
    expect(await readSession(session.id)).toEqual(original);
    expect(reports).toHaveBeenCalledTimes(1);
    reports.mockClear();
    const payload = await getReportPayload(session.id);
    const expected = serializePayload(original);
    expect(payload).toEqual({ session: expected.session, report: expected.report, messages: expected.messages });
    expect(reports).toHaveBeenCalledTimes(1);
    expect(payload.report.strengths.map((item) => item.title)).toEqual(["前项", "后项"]);
    expect(payload.report.gaps.map((item) => item.title)).toEqual(["优先缺项", "次要缺项"]);
    expect(payload.report.nextSteps).toEqual(["先做", "后做"]);
    expect(payload.report.gaps[0].latestRetry).toEqual({ sessionId: latest.id, phase: "DIAGNOSIS" });
    await prisma.learningSession.update({ where: { id: latest.id }, data: { phase: "COMPLETED" } });
    expect((await getReportPayload(session.id)).report.gaps[0].latestRetry).toEqual({ sessionId: latest.id, phase: "COMPLETED" });
  });

  it("keeps report-not-found behavior for absent reports and absent sessions", async () => {
    const user = await createDataServiceUser("data-report-absent");
    const session = await createSession({ ...task, userId: user.id });
    const missing = { code: "NOT_FOUND", status: 404, message: "学习报告不存在。" };
    await expect(getReportPayload(session.id)).rejects.toMatchObject(missing);
    await prisma.learningSession.delete({ where: { id: session.id } });
    await expect(readSession(session.id)).resolves.toBeNull();
    await expect(getReportPayload(session.id)).rejects.toMatchObject(missing);
  });

  it("stores a globally unique client request only once", async () => {
    const user = await createDataServiceUser("idempotency");
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
    const user = await createDataServiceUser("cascade");
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
