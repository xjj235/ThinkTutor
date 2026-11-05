import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as answerRoute } from "@/app/api/sessions/[id]/answers/route";
import { GET as sessionRoute } from "@/app/api/sessions/[id]/route";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { CoachTurnInput } from "@/lib/ai/types";
import { prisma } from "@/lib/db";
import { AIProviderError } from "@/lib/errors";
import { createLearningSession, getSessionPayload, requestHint, submitLearningAnswer } from "@/lib/session-service";
import { createTestUser } from "../factories";

// Authentication is request-local even when the two route invocations overlap.
const auth = new AsyncLocalStorage<Awaited<ReturnType<typeof createTestUser>>>();
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => {
  const user = auth.getStore();
  if (!user) throw new Error("Test request has no authenticated user");
  return user;
} }));

const userIds: string[] = [];
async function student() {
  const user = await createTestUser("multi-session");
  userIds.push(user.id);
  return user;
}
async function session(userId: string, marker: string) {
  return createLearningSession(userId, {
    course: undefined, chapter: undefined, topic: `独立主题${marker}`, objective: `解释${marker}的原因`,
    learnerLevel: "入门", referenceText: `仅用于${marker}的参考材料。`,
  }, { clientRequestId: crypto.randomUUID() });
}
function barrier() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}
function postAnswer(id: string, answer: string, clientRequestId: string) {
  return answerRoute(new Request(`http://localhost/api/sessions/${id}/answers`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer, clientRequestId }),
  }), { params: Promise.resolve({ id }) });
}

describe("concurrent learning session isolation", () => {
  beforeEach(() => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("RATE_LIMIT_AI_PER_MINUTE", "1000");
    vi.stubEnv("RATE_LIMIT_AI_PER_DAY", "100000");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  afterAll(async () => {
    await prisma.learningSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("keeps three overlapping contexts isolated and lets other sessions commit while one fails and retries", async () => {
    const [owner, other] = await Promise.all([student(), student()]);
    const markers = ["会话甲独有证据", "会话乙独有证据", "他人丙独有证据"];
    const sessions = await Promise.all(markers.map((marker, index) => session(index < 2 ? owner.id : other.id, marker)));
    await Promise.all(sessions.map(async (item, index) => {
      await submitLearningAnswer(item.session.id, { answer: `${markers[index]}是本次观察。`, clientRequestId: crypto.randomUUID() });
      await prisma.learningSession.update({ where: { id: item.session.id }, data: { contextSummary: `${markers[index]}的此前摘要` } });
    }));
    const before = await Promise.all(sessions.map((item) => getSessionPayload(item.session.id)));
    const gates = sessions.map(barrier);
    const captured = new Map<string, CoachTurnInput>();
    const original = MockAIProvider.prototype.createCoachTurn;
    let failFirstSession = true;
    vi.spyOn(MockAIProvider.prototype, "createCoachTurn").mockImplementation(async function (this: MockAIProvider, input) {
      const index = sessions.findIndex((item) => item.session.id === input.sessionId);
      expect(index).toBeGreaterThanOrEqual(0);
      captured.set(input.sessionId!, structuredClone(input));
      await gates[index].wait;
      if (index === 0 && failFirstSession) throw new AIProviderError("AI_TIMEOUT", "受控隔离测试超时", 503, true);
      const output = await original.call(this, input);
      return { ...output, assistantMessage: `请继续说明${markers[index]}的依据？` };
    });
    const requestIds = sessions.map(() => crypto.randomUUID());
    const work = sessions.map((item, index) => submitLearningAnswer(item.session.id, {
      answer: `${markers[index]}因为条件变化而出现。`, clientRequestId: requestIds[index],
    }));
    const settled = Promise.allSettled(work);
    try {
      await vi.waitFor(() => expect(captured.size).toBe(3)); // All three reached AI before any completed.
      for (const [index, item] of sessions.entries()) {
        const input = captured.get(item.session.id)!;
        expect(input.userId).toBe(index < 2 ? owner.id : other.id);
        expect(input.contextSummary).toBe(`${markers[index]}的此前摘要`);
        expect(input.task.referenceText).toContain(markers[index]);
        expect(input.messages.some((message) => message.content === `${markers[index]}是本次观察。`)).toBe(true);
        const serialized = JSON.stringify(input);
        for (const foreign of markers.filter((marker) => marker !== markers[index])) expect(serialized).not.toContain(foreign);
      }
      gates[1].release(); gates[2].release();
      await vi.waitFor(async () => {
        expect((await getSessionPayload(sessions[1].session.id)).session.version).toBe(before[1].session.version + 1);
        expect((await getSessionPayload(sessions[2].session.id)).session.version).toBe(before[2].session.version + 1);
      });
      expect(await getSessionPayload(sessions[0].session.id)).toEqual(before[0]);
      gates[0].release();
      const results = await settled;
      expect(results[0]).toMatchObject({ status: "rejected", reason: { code: "AI_TIMEOUT" } });
      expect(results.slice(1).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await getSessionPayload(sessions[0].session.id)).toEqual(before[0]);
      expect(await prisma.message.findUnique({ where: { clientRequestId: requestIds[0] } })).toBeNull();
      failFirstSession = false;
      const retried = await submitLearningAnswer(sessions[0].session.id, {
        answer: `${markers[0]}因为条件变化而出现。`, clientRequestId: requestIds[0], expectedVersion: before[0].session.version,
      });
      expect(retried.duplicate).toBe(false);
      for (const [index, item] of sessions.entries()) {
        const saved = await getSessionPayload(item.session.id);
        expect(saved.session.version).toBe(before[index].session.version + 1);
        expect(saved.session.socraticTurns).toBe(before[index].session.socraticTurns + 1);
        expect(saved.messages).toHaveLength(before[index].messages.length + 2);
        expect(saved.messages.at(-1)?.content).toContain(markers[index]);
        for (const foreign of markers.filter((marker) => marker !== markers[index])) expect(JSON.stringify(saved)).not.toContain(foreign);
      }
    } finally {
      gates.forEach((gate) => gate.release());
      await settled;
    }
  });

  it("blocks a competing hint and foreign API reads/writes while the owner's answer is pending", async () => {
    const [owner, other] = await Promise.all([student(), student()]);
    const ownSession = await session(owner.id, "所有者私有标记");
    const otherSession = await session(other.id, "其他学生标记");
    const before = await getSessionPayload(ownSession.session.id);
    const gate = barrier();
    const original = MockAIProvider.prototype.createCoachTurn;
    const coach = vi.spyOn(MockAIProvider.prototype, "createCoachTurn").mockImplementation(async function (this: MockAIProvider, input) {
      await gate.wait;
      return original.call(this, input);
    });
    const requestId = crypto.randomUUID();
    const pending = auth.run(owner, () => postAnswer(ownSession.session.id, "所有者私有标记是当前解释。", requestId));
    try {
      await vi.waitFor(() => expect(coach).toHaveBeenCalledOnce());
      await expect(requestHint(ownSession.session.id, { clientRequestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
      const [read, write] = await Promise.all([
        auth.run(other, () => sessionRoute(new Request(`http://localhost/api/sessions/${ownSession.session.id}`), { params: Promise.resolve({ id: ownSession.session.id }) })),
        auth.run(other, () => postAnswer(ownSession.session.id, "尝试修改他人的会话", crypto.randomUUID())),
      ]);
      for (const response of [read, write]) {
        expect(response.status).toBe(403);
        const body: unknown = await response.json();
        expect(body).toMatchObject({ error: { code: "FORBIDDEN" } });
        expect(JSON.stringify(body)).not.toContain("所有者私有标记");
      }
      expect(coach).toHaveBeenCalledOnce();
      expect(await getSessionPayload(ownSession.session.id)).toEqual(before);
      gate.release();
      expect((await pending).status).toBe(200);
      // A globally reused request ID must never return the other session's payload.
      const collision = await auth.run(other, () => postAnswer(otherSession.session.id, "其他学生标记的新解释", requestId));
      expect(collision.status).toBe(409);
      expect(JSON.stringify(await collision.json())).not.toContain("所有者私有标记");
      expect(coach).toHaveBeenCalledOnce();
      expect((await getSessionPayload(otherSession.session.id)).messages).toHaveLength(1);
      const accepted = await getSessionPayload(ownSession.session.id);
      expect(accepted.messages).toHaveLength(before.messages.length + 2);
      const replay = await auth.run(owner, () => postAnswer(ownSession.session.id, "所有者私有标记是当前解释。", requestId));
      expect(replay.status).toBe(200);
      expect(coach).toHaveBeenCalledOnce();
    } finally { gate.release(); await pending; }
  });

  it.each(["RATE_LIMIT_AI_PER_MINUTE", "RATE_LIMIT_AI_PER_DAY"])("shares %s across a student's sessions without throttling another student", async (limit) => {
    const [owner, other] = await Promise.all([student(), student()]);
    const [first, second, unrelated] = await Promise.all([
      session(owner.id, "额度甲"), session(owner.id, "额度乙"), session(other.id, "额度丙"),
    ]);
    // The owner's two protected creation requests have consumed two slots.
    vi.stubEnv(limit, "3");
    const coach = vi.spyOn(MockAIProvider.prototype, "createCoachTurn");
    const results = await Promise.allSettled([first, second].map((item) => submitLearningAnswer(item.session.id, {
      answer: "这是本会话的初步解释。", clientRequestId: crypto.randomUUID(),
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "RATE_LIMITED" } });
    expect(coach).toHaveBeenCalledOnce();
    for (const [index, item] of [first, second].entries()) {
      const saved = await getSessionPayload(item.session.id);
      expect(saved.messages).toHaveLength(results[index].status === "fulfilled" ? 3 : 1);
      expect(saved.session.phase).toBe(results[index].status === "fulfilled" ? "SOCRATIC" : "DIAGNOSIS");
    }
    await expect(submitLearningAnswer(unrelated.session.id, { answer: "其他学生的独立解释。", clientRequestId: crypto.randomUUID() })).resolves.toMatchObject({ duplicate: false });
    expect(coach).toHaveBeenCalledTimes(2);
  });
});
