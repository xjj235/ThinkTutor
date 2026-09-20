import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { buildV12Report } from "@/lib/knowledge/v12-report";
import { linkReportEvidence } from "@/lib/knowledge/report-evidence";
import { applyV12Assessment } from "@/lib/knowledge/v12-engine";
import { claimSchema, type EvidenceRef } from "@/lib/knowledge/v12-schema";
import { knowledgeRuntimeSchema, type KnowledgeRuntime } from "@/lib/knowledge/runtime-schemas";

const manifest = buildV12Manifest();
function runtime() {
  return initialKnowledgeRuntime({ releaseId: "KR_SR_1_2", contentHash: "a".repeat(64), knowledgeVersion: "1.2", diagnosticVersion: "1.2", questionGraphVersion: "1.2", caseBankVersion: "1.2", rubricVersion: "1.2", promptVersion: "1.2", workflowVersion: "1.2", schemaVersion: "1.2", modelProvider: "mock", modelName: "mock" });
}
function observation(state: KnowledgeRuntime, id: string, content: string, independent: boolean, confidence: number) {
  const ref: EvidenceRef = { messageId: id, startOffset: 0, endOffset: content.length, extractedText: content };
  const rule = manifest.v12!.unitRules.C_SR_001;
  const evidenceIds = [...new Set([...rule.requiredAll, ...rule.requiredAny])];
  state.v12!.observations.push(...evidenceIds.map((evidenceId) => ({ evidenceId, ref, independent, confidence })));
  return ref;
}
function historicallyMastered(state: KnowledgeRuntime, refs: EvidenceRef[]) {
  state.v12!.unitStates.C_SR_001 = { status: "MASTERED", independentEvidenceCount: 2, verificationCount: 1, evidenceRefs: refs, questionIds: ["previous-1", "previous-2"], lastUpdatedAt: "2026-09-20T00:00:00.000Z" };
}

describe("report evidence reliability", () => {
  it.each([[false, 0.95], [true, 0.4]])("cites the reliable answer instead of an earlier hint or uncertain answer (%s, %s)", (independent, confidence) => {
    const state = runtime();
    const uncertain = "这个定义是提示后的回答，仍然需要核验。";
    const reliable = "系统性风险涉及金融体系整体功能受损，单个机构损失不必然构成系统性风险。";
    const first = observation(state, "uncertain", uncertain, independent as boolean, confidence as number);
    const second = observation(state, "reliable", reliable, true, 0.95);
    state.v12!.finalFeynmanMessageId = first.messageId;
    state.v12!.finalRevisionMessageId = second.messageId;
    historicallyMastered(state, [first, second]);
    const built = buildV12Report(manifest, state, [
      { id: first.messageId, role: "USER", content: uncertain },
      { id: second.messageId, role: "USER", content: reliable },
    ]);
    expect(built.report.dimensions.conceptCompleteness.score).toBeGreaterThan(0);
    expect(built.report.dimensions.conceptCompleteness.evidence).toContain(reliable);
    expect(built.evidenceLinks.conceptCompleteness).toEqual([second.messageId]);
    expect(built.report.strengths).toContainEqual({ title: manifest.knowledgeUnits.find((u) => u.id === "C_SR_001")!.title, evidence: `学生原文：“${reliable}”` });
    expect(JSON.stringify(built.report.strengths)).not.toContain(uncertain);
  });

  it.each([[false, 0.95], [true, 0.4]])("does not repeat historical mastery when final evidence is hinted or uncertain (%s, %s)", (independent, confidence) => {
    const state = runtime();
    const content = "最后一次的表达仍然需要更多独立验证。";
    const ref = observation(state, "final", content, independent as boolean, confidence as number);
    historicallyMastered(state, [ref]);
    state.v12!.finalFeynmanMessageId = ref.messageId;
    const built = buildV12Report(manifest, state, [{ id: ref.messageId, role: "USER", content }]);
    expect(built.report.strengths).toEqual([]);
    expect(built.report.dimensions.conceptCompleteness.score).toBe(0);
    expect(built.report.dimensions.conceptCompleteness.evidence).toContain("未充分展示");
  });

  it("does not use a partial final answer to confirm a historical mastery label", () => {
    const state = runtime();
    const content = "我只提到了金融体系，还没有解释功能受损。";
    const ref = observation(state, "partial", content, true, 0.9);
    state.v12!.observations = state.v12!.observations.filter((o) => o.evidenceId === "financial_system_scope");
    state.v12!.finalFeynmanMessageId = ref.messageId;
    historicallyMastered(state, [ref]);
    const built = buildV12Report(manifest, state, [{ id: ref.messageId, role: "USER", content }]);
    expect(built.report.strengths).toEqual([]);
  });

  it.each(["传播", "共同暴露", "流动性挤兑"])("links permitted short student quotations to the actual answer: %s", (quote) => {
    const state = runtime();
    state.v12!.finalFeynmanMessageId = "answer";
    const content = `我需要继续解释${quote}的含义。`;
    const built = buildV12Report(manifest, state, [{ id: "answer", role: "USER", content }]);
    built.report.dimensions.conceptCompleteness.evidence = `学生原文：“${quote}”`;
    const links = linkReportEvidence(built.report, [
      { id: "answer", role: "USER", content },
      { id: "coach", role: "ASSISTANT", content },
      { id: "different-answer", role: "USER", content: "我尚未回答这个问题。" },
    ]);
    expect(links.conceptCompleteness).toEqual(["answer"]);
  });
});

describe("historical gap evidence validation", () => {
  const historicalContent = "先前的回答尚未解释金融体系功能受损的判断条件。";
  function withClaim(refs: EvidenceRef[]) {
    const state = runtime();
    const claimId = Object.keys(manifest.v12!.gaps)[0];
    state.v12!.gapStates[claimId] = claimSchema.parse({ claimId, status: "CONFIRMED", modelAssessmentConfidence: 0.9, evidenceConsistency: 1, verificationCount: 2, contradictionCount: 0, systemConfidence: 0.9, evidenceRefs: refs });
    state.v12!.finalFeynmanMessageId = "final";
    return knowledgeRuntimeSchema.parse(state);
  }
  const historicalRef: EvidenceRef = { messageId: "history", startOffset: 0, endOffset: historicalContent.length, extractedText: historicalContent };
  const finalMessage = { id: "final", role: "USER", content: "最后一条回答仍然不能完整解释这个概念。" };

  it("does not label missing evidence in a schema-valid saved claim as a student quotation", () => {
    const state = withClaim([]);
    const result = buildV12Report(manifest, state, [finalMessage]);
    expect(result.report.gaps[0].evidence).toContain("缺少可核验的学生原文");
    expect(result.report.gaps[0].evidence).not.toContain("学生原文：“");
    expect(state.v12!.needsTeacherReview).toBe(true);
  });

  it("accepts exact historical student evidence outside the final scoring window", () => {
    const state = withClaim([historicalRef]);
    const result = buildV12Report(manifest, state, [{ id: "history", role: "USER", content: historicalContent }, finalMessage]);
    expect(result.report.gaps[0].evidence).toContain(`学生原文：“${historicalContent}”`);
  });

  it.each([
    { label: "missing source message", ref: { ...historicalRef, messageId: "not-in-session" }, role: "USER" },
    { label: "assistant source message", ref: historicalRef, role: "ASSISTANT" },
    { label: "wrong start offset", ref: { ...historicalRef, startOffset: 1 }, role: "USER" },
    { label: "out-of-range end offset", ref: { ...historicalRef, endOffset: historicalContent.length + 1 }, role: "USER" },
    { label: "fabricated text", ref: { ...historicalRef, extractedText: "没有实际出现的学生回答。" }, role: "USER" },
  ])("rejects $label before rendering a historical gap", ({ ref, role }) => {
    const state = withClaim([ref]);
    expect(() => buildV12Report(manifest, state, [{ id: "history", role, content: historicalContent }, finalMessage])).toThrow("Report evidence no longer matches message");
  });
});

it("keeps a gap open when a later final revision contradicts an earlier passing Feynman answer", () => {
  let state = runtime();
  state.currentTargetId = "C_SR_001";
  state.v12!.pedagogicalStage = "FEYNMAN_OUTPUT";
  const first = { id: "feynman-pass", role: "USER", content: "系统性风险需要考察金融体系功能受损，以及冲击在多个主体之间传播的机制。" };
  const second = { id: "revision-fail", role: "USER", content: "我改成认为任何一家银行倒闭本身就必然是系统性风险，不需要再观察体系功能。" };
  const assess = (message: typeof first, ids: string[]) => ({ evidence: ids.map((evidenceId) => ({ evidenceId, messageId: message.id, extractedText: message.content })), candidateMastery: [], candidateMisconceptions: [], candidateGaps: [], contradictions: [], modelAssessmentConfidence: 0.9, recommendTransition: false });
  state = applyV12Assessment(manifest, state, assess(first, ["financial_system_scope", "functional_impairment", "propagation", "mechanism_example"]), first, "2026-09-20T00:00:00.000Z");
  state.v12!.pedagogicalStage = "REFLECTION";
  state.v12!.reflectionTargetId = "C_SR_001";
  state = applyV12Assessment(manifest, state, assess(second, ["event_equals_systemic"]), second, "2026-09-20T00:01:00.000Z");
  const gapIds = Object.entries(manifest.v12!.gaps).filter(([, target]) => target === "C_SR_001").map(([id]) => id);
  expect(gapIds.length).toBeGreaterThan(0);
  expect(gapIds.every((id) => state.v12!.gapStates[id].status === "CONFIRMED")).toBe(true);
  const built = buildV12Report(manifest, state, [first, second]);
  expect(gapIds.every((id) => state.v12!.gapStates[id].status === "UNRESOLVED")).toBe(true);
  expect(state.v12!.finalClaims.filter((claim) => gapIds.includes(claim.id)).every((claim) => claim.status === "UNRESOLVED")).toBe(true);
  expect(built.report.gaps.some((gap) => gap.evidence.includes(second.content))).toBe(true);
  expect(built.report.strengths.some((strength) => strength.title === manifest.knowledgeUnits.find((unit) => unit.id === "C_SR_001")!.title)).toBe(false);
  // Also guard a stale saved mastery label: final contradictions take priority.
  state.v12!.unitStates.C_SR_001.status = "MASTERED";
  const repeated = buildV12Report(manifest, state, [first, second]);
  expect(repeated.report.strengths.some((strength) => strength.title === manifest.knowledgeUnits.find((unit) => unit.id === "C_SR_001")!.title)).toBe(false);
});
