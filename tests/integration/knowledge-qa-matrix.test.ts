import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { prisma } from "@/lib/db";
import { referenceKnowledgeUnits } from "@/lib/knowledge/reference-library";
import { getStudentKnowledgeCatalog } from "@/lib/knowledge/student-catalog";
import {
  createLearningSession,
  createRetrySession,
  getReportPayload,
  requestHint,
  submitFeynmanExplanation,
  submitLearningAnswer,
} from "@/lib/session-service";
import { createTestUser } from "../factories";

const catalog = getStudentKnowledgeCatalog();
const matrix = catalog.flatMap((topic) => topic.units.map((unit) => ({
  topicId: topic.id,
  unitId: unit.id,
  topic: `${topic.title} · ${unit.title}`,
  objective: unit.objective,
  content: referenceKnowledgeUnits.find((source) => source.id === unit.id)?.content ?? "",
})));

function expectSelectedContext(context: string[] | undefined, unitId: string) {
  expect(context).toHaveLength(3);
  expect(context?.[0]).toContain(`知识单元 ${unitId}：`);
  expect(context?.join("\n")).not.toMatch(/(?:C|M|D|SQ|DQ|CASE)_SR_|SYSTEM_PROMPT|minimum_answer|excellent_answer/u);
}

describe("all forty selected knowledge units complete a persisted grounded learning loop", () => {
  let studentId: string | undefined;

  beforeEach(async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000");
    vi.stubEnv("RATE_LIMIT_AI_PER_DAY", "10000");
    studentId = (await createTestUser("knowledge-qa-matrix")).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (studentId) await prisma.learningSession.deleteMany({ where: { userId: studentId } });
    studentId = undefined;
    vi.unstubAllEnvs();
  });

  it.each(matrix)("$unitId: $topic survives uncertainty, hints, explanation, report and retry", async (selected) => {
    if (!studentId) throw new Error("Missing test student");
    expect(matrix).toHaveLength(40);
    expect(selected.content).not.toBe("");
    const diagnostic = vi.spyOn(MockAIProvider.prototype, "createDiagnosticQuestion");
    const coach = vi.spyOn(MockAIProvider.prototype, "createCoachTurn");
    const reportProvider = vi.spyOn(MockAIProvider.prototype, "createLearningReport");

    const created = await createLearningSession(studentId, {
      knowledgeSelection: { topicId: selected.topicId, unitId: selected.unitId },
      course: undefined, chapter: undefined, referenceText: undefined,
      topic: "客户端请求系统性风险", objective: "客户端试图替换所选学习目标", learnerLevel: "有基础",
    }, { clientRequestId: crypto.randomUUID() });
    const id = created.session.id;
    expect(created.session).toMatchObject({ topic: selected.topic, objective: selected.objective, phase: "DIAGNOSIS", socraticTurns: 0 });
    expect(created.messages[0].content).toContain(selected.topic);
    expectSelectedContext(diagnostic.mock.calls[0]?.[0].retrievedContext, selected.unitId);
    expect(diagnostic.mock.calls[0]?.[0].knowledgePolicy).toBe("COURSE_KNOWLEDGE_FIRST");

    const uncertain = await submitLearningAnswer(id, { answer: "不知道", clientRequestId: crypto.randomUUID() });
    expect(uncertain.session).toMatchObject({ phase: "SOCRATIC", socraticTurns: 0 });
    expect(uncertain.messages.at(-1)?.questionType).toBe("SCAFFOLDED_HINT");
    const beforeHint = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    const hinted = await requestHint(id, { clientRequestId: crypto.randomUUID() });
    expect(hinted.session).toMatchObject({ phase: "SOCRATIC", socraticTurns: 0 });
    expect(hinted.messages.at(-1)?.questionType).toBe("SCAFFOLDED_HINT");
    const afterHint = await prisma.learningSession.findUniqueOrThrow({ where: { id } });
    expect(afterHint.learnerState).toEqual(beforeHint.learnerState);
    expect(coach.mock.calls.at(-1)?.[0].isHintRequest).toBe(true);

    const answer = `${selected.topic}：${selected.content}例如同一个冲击对不同暴露结构的主体影响不同，因为条件影响传导过程，所以需要核对具体合同、现金流和时间。不能仅因为出现损失就认定为系统性风险。`;
    let current = hinted;
    for (let round = 1; round <= 4; round += 1) {
      current = await submitLearningAnswer(id, { answer: `${answer}这是第${round}次独立解释，我会用实际资料检查判断。`, clientRequestId: crypto.randomUUID() });
      expect(current.session.topic).toBe(selected.topic);
      expect(current.session.socraticTurns).toBe(round);
      const timeline = JSON.stringify(current.messages.map(({ id: messageId, role, questionType, createdAt }) => ({ id: messageId, role, questionType, createdAt })));
      expect(current.session.phase, `${selected.unitId} round ${round}: ${timeline}`).toBe(round < 4 ? "SOCRATIC" : "FEYNMAN");
      if (round < 4) expect(current.availableActions?.canEnterFeynman, `${selected.unitId} round ${round}: ${timeline}`).toBe(false);
    }
    expect(coach).toHaveBeenCalledTimes(6);
    for (const [request] of coach.mock.calls) {
      expect(request.task.topic).toBe(selected.topic);
      expect(request.knowledgePolicy).toBe("COURSE_KNOWLEDGE_FIRST");
      expectSelectedContext(request.retrievedContext, selected.unitId);
    }
    expect(current.messages.at(-1)?.content).toContain(selected.topic);

    const explanation = `${answer}如果迁移到新案例，我会重新核对主体、暴露、冲击方向和约束条件，再解释相同机制是否仍然成立。`;
    const completed = await submitFeynmanExplanation(id, { explanation, clientRequestId: crypto.randomUUID() });
    expect(completed.payload.session).toMatchObject({ topic: selected.topic, phase: "COMPLETED" });
    const report = completed.report;
    if (!report) throw new Error("Expected a completed formative report");
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(report.gaps.every((gap) => gap.status === "OPEN")).toBe(true);
    expect(report.overallScore).toBe(Math.round(Object.values(report.dimensions).reduce((sum, dimension) => sum + dimension.score, 0) / 5));
    expect(reportProvider.mock.calls[0]?.[0].task.topic).toBe(selected.topic);
    expectSelectedContext(reportProvider.mock.calls[0]?.[0].retrievedContext, selected.unitId);
    const userMessageIds = new Set(completed.payload.messages.filter((message) => message.role === "USER").map((message) => message.id));
    expect(report.evidenceLinks?.conceptCompleteness.length).toBeGreaterThan(0);
    for (const messageId of Object.values(report.evidenceLinks ?? {}).flat()) expect(userMessageIds.has(messageId)).toBe(true);

    const retry = await createRetrySession(id, { clientRequestId: crypto.randomUUID() });
    expect(retry.session).toMatchObject({ topic: selected.topic, phase: "DIAGNOSIS", parentSessionId: id });
    expect(retry.session.objective).not.toBe(selected.objective);
    expect(retry.messages[0].content).toContain(selected.topic);
    expect(diagnostic).toHaveBeenCalledTimes(2);
    expectSelectedContext(diagnostic.mock.calls[1]?.[0].retrievedContext, selected.unitId);
    const savedRetry = await prisma.learningSession.findUniqueOrThrow({ where: { id: retry.session.id } });
    expect(savedRetry).toMatchObject({ source: "RETRY", topic: selected.topic, knowledgeRuntime: null });
    if (!savedRetry.sourceGapId) throw new Error("Retry must link to the selected report gap");
    expect(await prisma.learningGap.findUniqueOrThrow({ where: { id: savedRetry.sourceGapId } })).toMatchObject({ status: "IN_PROGRESS" });
    const refreshedReport = await getReportPayload(id);
    expect(refreshedReport.report.gaps.filter((gap) => gap.status === "IN_PROGRESS")).toHaveLength(1);
    expect(await prisma.learningSession.count({ where: { parentSessionId: id } })).toBe(1);
  });
});
