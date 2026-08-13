import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/errors";
import { createTestUser } from "../factories";
import {
  createLearningSession,
  createRetrySession,
  enterLearningFeynman,
  submitFeynmanExplanation,
  submitLearningAnswer,
} from "@/lib/session-service";

const task = {
  course: "金融学导论",
  chapter: "风险",
  topic: "系统性风险",
  objective: "理解局部风险如何传导成整体风险",
  learnerLevel: "有基础",
  referenceText: "系统性风险可通过关联、杠杆、流动性和预期传导。",
};

async function cleanDb() {
  await prisma.learningReport.deleteMany();
  await prisma.message.deleteMany();
  await prisma.learningSession.deleteMany();
}

describe("learning session integration flow", () => {
  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  it("creates a session, completes the loop, and creates a retry session", async () => {
    const user = await createTestUser("flow-complete");
    const created = await createLearningSession(user.id, task);
    expect(created.session.phase).toBe("DIAGNOSIS");
    expect(created.messages[0]?.content).toContain("系统性风险");

    const afterDiagnosis = await submitLearningAnswer(created.session.id, {
      answer: "我认为系统性风险是单个机构问题扩散到整个市场。",
      clientRequestId: "answer-diagnosis",
    });
    expect(afterDiagnosis.session.phase).toBe("SOCRATIC");
    expect(afterDiagnosis.session.socraticTurns).toBe(0);

    const duplicate = await submitLearningAnswer(created.session.id, {
      answer: "这次重复提交不应该再次写入数据库。",
      clientRequestId: "answer-diagnosis",
    });
    expect(duplicate.duplicate).toBe(true);

    const round1 = await submitLearningAnswer(created.session.id, {
      answer: "关键概念是传染，因为机构之间有资产和信心联系。",
      clientRequestId: "answer-round-1",
    });
    expect(round1.session.phase).toBe("SOCRATIC");
    expect(round1.session.socraticTurns).toBe(1);

    const round2 = await submitLearningAnswer(created.session.id, {
      answer: "如果流动性下降，会导致抛售和价格下跌。",
      clientRequestId: "answer-round-2",
    });
    expect(round2.session.phase).toBe("SOCRATIC");
    expect(round2.session.socraticTurns).toBe(2);

    const round3 = await submitLearningAnswer(created.session.id, {
      answer: "前提是机构之间存在共同风险敞口，因此局部冲击会放大。",
      clientRequestId: "answer-round-3",
    });
    expect(round3.session.phase).toBe("SOCRATIC");
    expect(round3.session.socraticTurns).toBe(3);

    const feynmanPhase = await enterLearningFeynman(created.session.id, {
      clientRequestId: "enter-feynman-1",
    });
    expect(feynmanPhase.session.phase).toBe("FEYNMAN");

    const completed = await submitFeynmanExplanation(created.session.id, {
      explanation:
        "系统性风险是局部冲击通过关联、杠杆和流动性扩散为整体风险。例如一家大机构被迫卖资产会导致价格下跌，所以其他机构也受损。如果换到供应链场景，也要看节点之间是否高度关联。",
      clientRequestId: "feynman-1",
    });
    expect(completed.payload.session.phase).toBe("COMPLETED");
    expect(completed.report.overallScore).toBeGreaterThan(0);

    const retry = await createRetrySession(created.session.id, {
      clientRequestId: "retry-0001",
    });
    expect(retry.session.parentSessionId).toBe(created.session.id);
    expect(retry.session.phase).toBe("DIAGNOSIS");
    expect(retry.duplicate).toBe(false);

    const duplicateRetry = await createRetrySession(created.session.id, {
      clientRequestId: "retry-0001",
    });
    expect(duplicateRetry.duplicate).toBe(true);
    expect(duplicateRetry.session.id).toBe(retry.session.id);
    expect(
      await prisma.learningSession.count({
        where: { parentSessionId: created.session.id },
      }),
    ).toBe(1);
  });

  it("does not write messages or advance state when the provider fails", async () => {
    const user = await createTestUser("flow-failure");
    const created = await createLearningSession(user.id, task);
    const before = await prisma.learningSession.findUniqueOrThrow({
      where: { id: created.session.id },
      include: { messages: true },
    });
    vi.spyOn(MockAIProvider.prototype, "createCoachTurn").mockRejectedValueOnce(
      new AIProviderError("AI_TIMEOUT", "timeout", 503, true),
    );

    await expect(
      submitLearningAnswer(created.session.id, {
        answer: "这是一次不会被写入数据库的完整回答。",
        clientRequestId: "answer-ai-failure",
      }),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT" });

    const after = await prisma.learningSession.findUniqueOrThrow({
      where: { id: created.session.id },
      include: { messages: true },
    });
    expect(after.phase).toBe(before.phase);
    expect(after.socraticTurns).toBe(before.socraticTurns);
    expect(after.messages).toHaveLength(before.messages.length);
  });
});
