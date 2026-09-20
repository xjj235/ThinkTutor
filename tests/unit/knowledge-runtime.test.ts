import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeManifests } from "@/lib/knowledge/static-manifests";
import { validateKnowledgeManifests } from "@/lib/knowledge/schemas";
import { createVersionSnapshot, releaseAllowed, resolvePinnedManifest } from "@/lib/knowledge/releases";
import { getServerEnv } from "@/lib/env";
import { initialKnowledgeRuntime, normalizeSignals, recordKnowledgeAction, recordKnowledgeAnswer, selectKnowledgeAction } from "@/lib/knowledge/orchestrator";
import { knowledgeRuntimeSchema } from "@/lib/knowledge/runtime-schemas";
import { StructuredKnowledgeRetriever } from "@/lib/retrieval/knowledge-retriever";
import { buildLearningContext } from "@/lib/ai/context-builder";
import { finalizeReportDraft } from "@/lib/scoring";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { linkReportEvidence } from "@/lib/knowledge/report-evidence";
import { register } from "@/instrumentation";

const manifest = knowledgeManifests[0];
const learner = { masteryEstimate: 30, confirmedPoints: [], gaps: ["M_SR_002"], misconceptions: [] };

describe("knowledge runtime safety", () => {
  beforeEach(() => vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("requires explicit draft override and never enables it in production", async () => {
    expect(releaseAllowed(manifest, "development", false)).toBe(false);
    expect(releaseAllowed(manifest, "development", true)).toBe(true);
    expect(releaseAllowed(manifest, "test", true)).toBe(true);
    expect(releaseAllowed(manifest, "competition", true)).toBe(true);
    expect(releaseAllowed(manifest, "competition", false)).toBe(false);
    expect(releaseAllowed(manifest, "production", true)).toBe(false);
    vi.stubEnv("DEPLOYMENT_ENV", "production");
    expect(() => getServerEnv()).toThrow("Production must not enable draft knowledge");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await expect(register()).rejects.toThrow("Production must not enable draft knowledge");
  });

  it("rejects fake publication, orphan groups, duplicate rubric dimensions and diagnostic targets", () => {
    const broken = structuredClone(manifest);
    broken.release.status = "published";
    broken.questionGroups[0].memberIds.push("missing-question");
    broken.cases[0].teacherData.followUpGroupIds = ["missing-group"];
    broken.diagnosticQuestions[0].targetConcepts = ["missing-unit"];
    broken.rubric.dimensions[1].code = broken.rubric.dimensions[0].code;
    const errors = validateKnowledgeManifests([broken]).errors.join("\n");
    for (const expected of ["reviewer", "SHA-256", "invalid member", "follow-up group", "diagnostic target", "unique"]) expect(errors).toContain(expected);
  });

  it("does not treat ambiguity or missing demonstrated skills as confirmed misconceptions", () => {
    const signals = normalizeSignals(manifest, { ...learner, misconceptions: ["ERR_EXPRESSION_AMBIGUITY", "ERR_E04_COMMON_EXPOSURE_FIRE_SALE_MISSING"] });
    expect(signals.candidateErrorIds).toEqual([]);
    expect(signals.candidateGapIds).toContain("GAP_FIRE_SALE_FEEDBACK");
    expect(signals.flags).toContain("FLAG_NEED_VERIFY");
  });

  it("selects a stable group and unused variants and bounds hints without changing the input", () => {
    const runtime = initialKnowledgeRuntime(createVersionSnapshot(manifest));
    const first = selectKnowledgeAction(manifest, runtime, learner, 0)!;
    expect(first.groupId).toBe("SQG_SR_004");
    const next = recordKnowledgeAction(runtime, first, manifest, learner);
    expect(runtime.usedQuestionIds).toEqual([]);
    expect(next.targetAttempts).toEqual({});
    expect(recordKnowledgeAnswer(next).targetAttempts).toEqual({ M_SR_002: 1 });
    expect(selectKnowledgeAction(manifest, next, learner, 1)?.questionId).toBe("SQ_SR_004_B");
    const hint1 = selectKnowledgeAction(manifest, next, learner, 1, true)!;
    const hinted = recordKnowledgeAction(next, hint1, manifest, learner);
    const hint2 = selectKnowledgeAction(manifest, hinted, learner, 1, true)!;
    const twice = recordKnowledgeAction(hinted, hint2, manifest, learner);
    expect(twice.flags).toContain("FLAG_NEED_VERIFY");
    expect(twice.targetAttempts).toEqual(next.targetAttempts);
    expect(selectKnowledgeAction(manifest, twice, learner, 1, true)).toBeNull();
    expect(knowledgeRuntimeSchema.parse(JSON.parse(JSON.stringify(twice)))).toEqual(twice);
  });

  it("uses a different case on a later exposure and never copies teacher answers", () => {
    const runtime = initialKnowledgeRuntime(createVersionSnapshot(manifest));
    const first = selectKnowledgeAction(manifest, runtime, learner, 3)!;
    expect(first.caseId).not.toBeNull();
    const next = recordKnowledgeAction(runtime, first, manifest, learner);
    const second = selectKnowledgeAction(manifest, next, learner, 4)!;
    expect(second.caseId).not.toBe(first.caseId);
    const text = JSON.stringify([first, second]);
    for (const item of manifest.cases) expect(text).not.toContain(item.teacherData.excellentAnswer);
  });

  it("blocks silent version drift and keeps report score anchors within server caps", async () => {
    const versions = createVersionSnapshot(manifest);
    expect(resolvePinnedManifest(versions).release.id).toBe(versions.releaseId);
    expect(() => resolvePinnedManifest({ ...versions, contentHash: "0".repeat(64) })).toThrow("知识版本");
    const runtime = initialKnowledgeRuntime(versions);
    runtime.flags = ["FLAG_NEED_VERIFY"];
    const draft = await new MockAIProvider().createLearningReport({ task: { course: undefined, chapter: undefined, referenceText: undefined, topic: "系统性风险", objective: "验证", learnerLevel: "入门" }, messages: [], feynmanExplanation: "这是对系统性风险的说明，机构联系可能使风险传播。" });
    for (const dimension of Object.values(draft.dimensions)) dimension.score = 99;
    const report = finalizeReportDraft(draft, runtime);
    expect(Object.values(report.dimensions).map((item) => item.score)).toEqual([75, 75, 75, 75, 75]);
    expect(report.overallScore).toBe(75);
    expect(draft.dimensions.conceptCompleteness.score).toBe(99);
    draft.dimensions.conceptCompleteness.evidence = "学生写道：“共同持仓会造成资产损失”。";
    draft.dimensions.logicCompleteness.evidence = "学生已经理解了风险。";
    const links = linkReportEvidence(draft, [
      { id: "student-1", role: "USER", content: "共同持仓会造成资产损失，但不一定是系统风险。" },
      { id: "assistant-1", role: "ASSISTANT", content: "共同持仓会造成资产损失" },
      { id: "student-2", role: "USER", content: "这是另一条学生回答。" },
    ]);
    expect(links.conceptCompleteness).toEqual(["student-1"]);
    expect(links.logicCompleteness).toEqual([]);
  });

  it("filters drafts and caps context to one question/case without unsolicited hints or rubrics", async () => {
    const input = { courseId: "public", query: "系统性风险", phase: "SOCRATIC" as const, targetConcept: "M_SR_002", limit: 12 };
    const retriever = new StructuredKnowledgeRetriever();
    const results = await retriever.retrieve({ ...input, usedQuestionIds: ["SQ_SR_004_A"], usedCaseIds: ["CASE_SR_001"] });
    expect(results.filter((item) => item.resourceType === "SOCRATIC_QUESTION")).toHaveLength(1);
    expect(results.filter((item) => item.resourceType === "CASE")).toHaveLength(1);
    expect(results.some((item) => ["HINT", "RUBRIC"].includes(item.resourceType ?? ""))).toBe(false);
    expect(results.map((item) => item.id)).not.toContain("SQ_SR_004_A");
    expect(results.map((item) => item.id)).not.toContain("CASE_SR_001");
    vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "false");
    expect(await retriever.retrieve(input)).toEqual([]);
  });

  it("resolves revision IDs without an error tag or private course binding", async () => {
    const context = await buildLearningContext({ topic: "系统性风险", objective: "概念", learnerState: { ...learner, gaps: ["M_SR_007"] }, phase: "SOCRATIC", messages: [] });
    expect(context.retrievedContext.join("\n")).toContain("Target unit: M_SR_007");
  });

  it("keeps pinned knowledge in generic queries and supplies the actual unit content", async () => {
    const retriever = new StructuredKnowledgeRetriever();
    const diagnostic = await retriever.retrieve({ courseId: "curated-public", query: "解释风险传播路径", releaseId: "KR_SR_1_2", phase: "DIAGNOSIS", limit: 6 });
    expect(diagnostic.some((item) => item.resourceType === "DIAGNOSTIC_QUESTION")).toBe(true);
    const results = await retriever.retrieve({ courseId: "curated-public", query: "解释机制", releaseId: "KR_SR_1_2", targetConcept: "M_SR_002", phase: "SOCRATIC", limit: 8 });
    expect(results.find((item) => item.id === "M_SR_002")?.content).toContain(manifest.knowledgeUnits.find((unit) => unit.id === "M_SR_002")!.content);
    expect(results.filter((item) => item.resourceType === "KNOWLEDGE_UNIT").length).toBeLessThanOrEqual(3);
    expect(results.some((item) => item.visibility === "TEACHER")).toBe(false);
  });
});
