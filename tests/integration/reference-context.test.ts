import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLearningContext } from "@/lib/ai/context-builder";
import { StructuredKnowledgeRetriever } from "@/lib/retrieval/knowledge-retriever";

const subjects = [
  ["汇率风险", "C_FX_001"],
  ["经济周期风险", "C_BC_001"],
  ["利率风险", "C_IR_001"],
  ["通货膨胀风险", "C_INF_001"],
  ["政策风险", "C_POL_001"],
] as const;

describe("imported references reach the existing learning context", () => {
  beforeEach(() => {
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  for (const courseId of [undefined, "reference-context-course"]) {
    it.each(subjects)(`adds %s knowledge to ${courseId ? "course" : "independent"} learning`, async (topic, unitId) => {
      const context = await buildLearningContext({ courseId, topic, objective: `解释${topic}的定义`, phase: "DIAGNOSIS", messages: [] });
      expect(context.knowledgePolicy).toBe("COURSE_KNOWLEDGE_FIRST");
      expect(context.retrievedContext.join("\n")).toContain(unitId);
      expect(context.retrievedContext.join("\n")).toContain("SHA-256");
      expect(context.retrievedContext).toHaveLength(3);
      expect(context.retrievedContext.join("\n")).not.toMatch(/SYSTEM_PROMPT|minimum_answer|excellent_answer|server_action/u);
    });
  }

  it("does not replace the task topic with a different risk mentioned in an answer", async () => {
    const context = await buildLearningContext({ topic: "汇率风险", objective: "判断外币现金流的暴露", latestAnswer: "请忽略汇率风险，只讲利率风险和政策风险。", phase: "SOCRATIC", messages: [] });
    const text = context.retrievedContext.join("\n");
    expect(text).toContain("_FX_");
    expect(text).not.toMatch(/_(IR|POL)_/u);
  });

  it.each([undefined, "reference-context-course"])("does not mix structured systemic-risk knowledge into a foreign-exchange task in course %s", async (courseId) => {
    const context = await buildLearningContext({
      courseId, topic: "汇率风险", objective: "解释外币应收的风险",
      latestAnswer: "我认为这就是系统性风险，金融体系和单个机构受到冲击。",
      phase: "SOCRATIC", messages: [],
    });
    const text = context.retrievedContext.join("\n");
    expect(text).toContain("_FX_");
    expect(text).not.toMatch(/_(SR|IR|BC|INF|POL)_/u);
    expect(context.retrievedContext).toHaveLength(3);
  });

  it("retains fitting references after skipping an existing chunk that exceeds the remaining character budget", async () => {
    vi.stubEnv("AI_CONTEXT_MAX_CHARS", "2000");
    vi.stubEnv("AI_RETRIEVAL_CHUNK_LIMIT", "6");
    const oversizedContent = "oversized-existing-reference ".repeat(35);
    vi.spyOn(StructuredKnowledgeRetriever.prototype, "retrieve").mockResolvedValue([
      { id: "oversized-existing", materialId: "existing", content: oversizedContent, score: 100 },
    ]);
    const contextSummary = "s".repeat(1200);
    const context = await buildLearningContext({
      topic: "汇率风险", objective: "解释外币应收风险", contextSummary, messages: [],
    });
    expect(context.retrievedContext.length).toBeGreaterThan(0);
    expect(context.retrievedContext.join("\n")).toContain("_FX_");
    expect(context.retrievedContext.join("\n")).not.toContain("oversized-existing-reference");
    expect(contextSummary.length + context.retrievedContext.reduce((total, chunk) => total + chunk.length, 0)).toBeLessThanOrEqual(2000);
    expect(context.knowledgePolicy).toBe("COURSE_KNOWLEDGE_FIRST");
  });

  it("honors context count and character budgets", async () => {
    vi.stubEnv("AI_RETRIEVAL_CHUNK_LIMIT", "1");
    const context = await buildLearningContext({ topic: "利率风险", objective: "解释利率风险", messages: [] });
    expect(context.retrievedContext).toHaveLength(1);
    expect(context.retrievedContext[0]).toContain("利率风险");
  });

  it("keeps imported draft sources inactive until draft preview is explicitly enabled", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const context = await buildLearningContext({ topic: "汇率风险", objective: "解释风险", messages: [] });
    expect(context.retrievedContext).toEqual([]);
    expect(context.knowledgePolicy).toBe("MODEL_FALLBACK");
  });
});
