import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionInputSchema } from "@/lib/contracts";
import { getStudentKnowledgeCatalog } from "@/lib/knowledge/student-catalog";
import { ReferenceDocumentRetriever } from "@/lib/retrieval/reference-retriever";

const expectedTopics = [
  ["exchange-rate-risk", "汇率风险"],
  ["economic-cycle-risk", "经济周期风险"],
  ["interest-rate-risk", "利率风险"],
  ["inflation-risk", "通货膨胀风险"],
  ["policy-risk", "政策风险"],
] as const;
const task = { topic: "占位主题", objective: "占位学习目标", learnerLevel: "入门" };

describe("student knowledge catalog", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exposes all five topics and forty units with only public selection fields", () => {
    const catalog = getStudentKnowledgeCatalog();
    expect(catalog.map(({ id, title }) => [id, title])).toEqual(expectedTopics);
    expect(catalog.flatMap((topic) => topic.units)).toHaveLength(40);
    expect(new Set(catalog.flatMap((topic) => topic.units.map((unit) => unit.id))).size).toBe(40);
    for (const topic of catalog) {
      expect(Object.keys(topic).sort()).toEqual(["id", "objective", "title", "units"]);
      expect(topic.objective.trim().length).toBeGreaterThan(0);
      expect(topic.units).toHaveLength(8);
      for (const unit of topic.units) {
        expect(Object.keys(unit).sort()).toEqual(["id", "objective", "title"]);
        expect(unit.title.trim().length).toBeGreaterThan(0);
        expect(unit.objective.trim().length).toBeGreaterThan(0);
      }
    }
    expect(JSON.stringify(catalog)).not.toMatch(/SYSTEM_PROMPT|minimum_answer|excellent_answer|teacher_internal_tags|sha256|sourcePath|blocks|封顶规则/u);
  });

  it.each(["development", "test", "production"])("keeps the public learning menu available in %s with draft knowledge disabled", (environment) => {
    vi.stubEnv("DEPLOYMENT_ENV", environment);
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    expect(getStudentKnowledgeCatalog()).toHaveLength(5);
    expect(getStudentKnowledgeCatalog().flatMap((topic) => topic.units)).toHaveLength(40);
  });

  it("accepts whole-topic and individual-unit selections", () => {
    expect(createSessionInputSchema.safeParse({ ...task, knowledgeSelection: { topicId: "exchange-rate-risk" } }).success).toBe(true);
    expect(createSessionInputSchema.safeParse({ ...task, knowledgeSelection: { topicId: "exchange-rate-risk", unitId: "M_FX_001" } }).success).toBe(true);
  });

  it.each(["topic", "objective", "learnerLevel"])("still requires the ordinary %s field for a catalog selection", (field) => {
    expect(createSessionInputSchema.safeParse({ ...task, [field]: "", knowledgeSelection: { topicId: "exchange-rate-risk" } }).success).toBe(false);
  });

  it("rejects unexpected client fields inside a selection", () => {
    expect(createSessionInputSchema.safeParse({ ...task, knowledgeSelection: { topicId: "exchange-rate-risk", trusted: true } }).success).toBe(false);
  });
});

describe("selected student knowledge unit retrieval", () => {
  beforeEach(() => {
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(expectedTopics)("prioritizes every explicitly selected unit in %s despite competing answer text", async (id) => {
    const topic = getStudentKnowledgeCatalog().find((item) => item.id === id);
    if (!topic) throw new Error(`Missing catalog topic ${id}`);
    for (const unit of topic.units) {
      const distractor = topic.units.find((item) => item.id !== unit.id);
      const results = await new ReferenceDocumentRetriever().retrieve({
        courseId: "curated-public", topic: `${topic.title} · ${unit.title}`, objective: unit.objective,
        query: `${topic.title} ${(distractor?.title ?? "其他知识").repeat(20)}`, limit: 3,
      });
      expect(results[0]?.knowledgeUnitId, `${topic.title}: ${unit.title}`).toBe(unit.id);
      expect(results.every((result) => result.materialId === `${id}-01`)).toBe(true);
    }
  });

  it("keeps selection available while excluding draft source text when preview is disabled", async () => {
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    const topic = getStudentKnowledgeCatalog()[0];
    const unit = topic.units[0];
    expect(await new ReferenceDocumentRetriever().retrieve({
      courseId: "curated-public", topic: `${topic.title} · ${unit.title}`, objective: unit.objective, query: topic.title, limit: 3,
    })).toEqual([]);
  });
});
