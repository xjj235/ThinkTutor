import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLearningContext } from "@/lib/ai/context-builder";
import { knowledgeManifests } from "@/lib/knowledge/static-manifests";
import { validateKnowledgeManifests } from "@/lib/knowledge/schemas";
import { StructuredKnowledgeRetriever } from "@/lib/retrieval/knowledge-retriever";

describe("structured knowledge base", () => {
  beforeEach(() => vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it("validates revision 1.1 ids, source links, graph references, case bank, and rubric dimensions", () => {
    const result = validateKnowledgeManifests(knowledgeManifests);
    const manifest = result.manifests[0];
    expect(result.errors).toEqual([]);
    expect(manifest?.knowledgePoint.version).toBe("1.1");
    expect(manifest?.knowledgeUnits).toHaveLength(13);
    expect(manifest?.diagnosticQuestions).toHaveLength(15);
    expect(manifest?.socraticQuestions).toHaveLength(30);
    expect(manifest?.knowledgeUnits.every((unit) => unit.sourceRefs.length > 0)).toBe(true);
    expect(manifest?.cases).toHaveLength(8);
    expect(new Set(manifest?.cases.map((item) => item.caseType))).toEqual(new Set(["basic", "counterexample", "comprehensive", "transfer"]));
    expect(manifest?.cases.flatMap((item) => item.targetUnits)).toEqual(expect.arrayContaining([
      "C_SR_001",
      "M_SR_002",
      "M_SR_003",
      "M_SR_004",
      "M_SR_005",
      "M_SR_006",
      "D_SR_002",
      "C_SR_003",
      "M_SR_007",
      "C_SR_004",
    ]));
    expect(manifest?.rubric.dimensions.map((dimension) => dimension.code)).toEqual([
      "concept_completeness",
      "logic_completeness",
      "expression_clarity",
      "example_ability",
      "transfer_ability",
    ]);
  });

  it("retrieves the direct-link misconception branch before generic definition review", async () => {
    const results = await new StructuredKnowledgeRetriever().retrieve({
      courseId: "course-test",
      query: "系统性风险 没有银行间借贷还会传染吗",
      phase: "SOCRATIC",
      errorTags: ["ERR_E03_DIRECT_LINK_ONLY"],
      limit: 10,
    });

    expect(results.map((item) => item.id)).toContain("ERR_E03_DIRECT_LINK_ONLY");
    expect(results.map((item) => item.id)).toContain("M_SR_002");
    expect(results.map((item) => item.id)).toContain("SQ_SR_004_A");
    expect(results.some((item) => item.resourceType === "CASE" && item.content.includes("M_SR_002"))).toBe(true);
  });

  it("retrieves transfer cases for real-economy feedback gaps", async () => {
    const results = await new StructuredKnowledgeRetriever().retrieve({
      courseId: "course-test",
      query: "系统性风险 只会定义 不会分析企业和信贷收缩",
      phase: "SOCRATIC",
      targetConcept: "M_SR_007",
      errorTags: ["ERR_E07_DEFINITION_ONLY"],
      limit: 8,
    });

    expect(results.map((item) => item.id)).toContain("M_SR_007");
    expect(results.some((item) => item.resourceType === "SOCRATIC_QUESTION" && item.content.includes("Target unit: M_SR_007"))).toBe(true);
    expect(results.some((item) => item.resourceType === "CASE" && item.content.includes("M_SR_007"))).toBe(true);
  });

  it("adds structured context to prompt assembly without exposing teacher-only case answers", async () => {
    const context = await buildLearningContext({
      courseId: "course-test",
      topic: "系统性风险",
      objective: "解释没有直接借贷时风险仍可能传播",
      latestAnswer: "如果银行之间没有借贷，就不会相互影响。",
      phase: "SOCRATIC",
      learnerState: {
        masteryEstimate: 30,
        confirmedPoints: [],
        gaps: ["M_SR_002"],
        misconceptions: ["ERR_E03_DIRECT_LINK_ONLY"],
      },
      messages: [],
    });

    const text = context.retrievedContext.join("\n");
    expect(context.knowledgePolicy).toBe("COURSE_KNOWLEDGE_FIRST");
    expect(text).toContain("M_SR_002");
    expect(text).toContain("SQ_SR_004_A");
    expect(text).toContain("Case CASE_SR_");
    expect(text).toContain("M_SR_002");
    expect(text).not.toContain("excellentAnswer");
    expect(text).not.toContain("expectedReasoning");
    expect(text).not.toContain("minimumAnswer");
  });
});
