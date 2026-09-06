import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { validateKnowledgeManifests } from "@/lib/knowledge/schemas";
import { aggregateDiagnosticLevel, applyV12Assessment, constructionReady, evaluateEvidenceRule, initialV12State, mergeCaseExposureHistory, recordV12Action, selectV12Action } from "@/lib/knowledge/v12-engine";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { nextV12Transition } from "@/lib/state-machine";
import { turnAssessmentSchema, type TurnAssessment } from "@/lib/knowledge/v12-schema";
import { buildV12Report } from "@/lib/knowledge/v12-report";

const m = buildV12Manifest();
const now = "2026-09-04T00:00:00.000Z";
function runtime() {
  return initialKnowledgeRuntime({ releaseId: "KR_SR_1_2", contentHash: "a".repeat(64), knowledgeVersion: "1.2", diagnosticVersion: "1.2", questionGraphVersion: "1.2", caseBankVersion: "1.2", rubricVersion: "1.2", promptVersion: "1.2", workflowVersion: "1.2", schemaVersion: "1.2", modelProvider: "mock", modelName: "mock" });
}
function candidate(messageId: string, content: string, ids: string[], confidence = 0.9): TurnAssessment {
  return { evidence: ids.map((evidenceId) => ({ evidenceId, messageId, extractedText: content })), candidateMisconceptions: [], candidateGaps: [], candidateMastery: [], modelAssessmentConfidence: confidence, contradictions: [], recommendTransition: true };
}
function answer(state: ReturnType<typeof runtime>, ids: string[], i: number, confidence = 0.9) {
  state.currentQuestionId = `DQ_SR_001_${"ABC"[i % 3]}`;
  state.currentTargetId = "C_SR_001";
  const msg = { id: `msg-${i}`, content: `独立测试回答第${i}次，明确描述相应概念和条件。` };
  return applyV12Assessment(m, state, candidate(msg.id, msg.content, ids, confidence), msg, now);
}
describe("v1.2 evidence workflow", () => {
  it("preserves the old release and builds eleven single-target groups and eight cases", () => {
    expect(validateKnowledgeManifests([m]).errors).toEqual([]);
    expect(m.release.status).toBe("draft");
    expect(m.release.verifiedBy).toBeNull();
    expect(m.questionGroups).toHaveLength(11);
    expect(m.v12?.relations).toHaveLength(8);
    expect(m.v12?.competencies).toHaveLength(3);
    expect(m.v12?.pedagogyRules).toHaveLength(18);
    expect(m.socraticQuestions.some((q) => q.id.startsWith("SQ_SR_006_"))).toBe(false);
    expect(m.questionGroups.find((g) => g.id === "SQG_SR_010")?.targetId).toBe("COMP_SR_TRANSFER");
    expect(m.cases[2].teacherData.followUpGroupIds).toEqual(expect.arrayContaining(["SQG_SR_006A", "SQG_SR_006B"]));
  });
  it("requires positive and required-any evidence and rejects contradictions", () => {
    const rule = m.v12!.diagnosticRules.DQG_SR_004;
    expect(evaluateEvidenceRule(rule, ["no_direct_link_required", "shared_asset_exposure"])).toBe("PASS");
    expect(evaluateEvidenceRule(rule, ["no_direct_link_required"])).toBe("PARTIAL");
    expect(evaluateEvidenceRule(rule, ["no_direct_link_required", "shared_asset_exposure", "direct_link_only"])).toBe("FAIL");
  });
  it("rejects fabricated quotes, message ids, unknown signals and LLM transitions", () => {
    const r = runtime(); r.currentQuestionId = "DQ_SR_001_A";
    const c = candidate("other", "伪造的原文", ["financial_system_scope"]);
    expect(() => applyV12Assessment(m, r, c, { id: "real", content: "这是学生真实的回答。" }, now)).toThrow(/reference/);
    expect(turnAssessmentSchema.safeParse({ ...c, phase: "COMPLETED" }).success).toBe(false);
  });
  it("does not master a KU from one answer or low-confidence evidence", () => {
    const ids = ["financial_system_scope", "functional_impairment", "research_object_distinction", "systemic_scope", "systematic_market_factor"];
    const r = answer(runtime(), ids, 0);
    expect(r.v12!.unitStates.C_SR_001.status).toBe("PARTIAL");
    expect(answer(r, ids, 1, 0.4).v12!.unitStates.C_SR_001.status).toBe("PARTIAL");
    expect(answer(r, ids, 1).v12!.unitStates.C_SR_001.status).toBe("PARTIAL");
    expect(answer(r, [...ids, "condition_revision"], 1).v12!.unitStates.C_SR_001.status).toBe("MASTERED");
  });
  it("does not count a hint answer as independent evidence", () => {
    let r = answer(runtime(), ["financial_system_scope", "functional_impairment"], 0);
    r.v12!.activityType = "HINT";
    r = answer(r, ["financial_system_scope", "functional_impairment"], 1);
    expect(r.v12!.unitStates.C_SR_001.status).toBe("PARTIAL");
    expect(r.flags).toContain("FLAG_NEED_VERIFY");
  });
  it("does not award scores from a self-contradictory final answer", () => {
    const r = answer(runtime(), Object.keys(m.v12!.evidenceDefinitions), 0);
    r.v12!.finalRevisionMessageId = "msg-0";
    const report = buildV12Report(m, r, [{ id: "msg-0", role: "USER", content: "独立测试回答第0次，明确描述相应概念和条件。" }]).report;
    expect(report.overallScore).toBe(0);
    expect(r.v12!.needsTeacherReview).toBe(true);
  });
  it("executes prerequisites, 006A/006B and success edges", () => {
    const r = runtime(); r.v12!.pedagogicalStage = "KNOWLEDGE_CONSTRUCTION";
    const mastered = { status: "MASTERED" as const, evidenceRefs: [], independentEvidenceCount: 2, verificationCount: 1, questionIds: ["q1", "q2"], lastUpdatedAt: now };
    r.v12!.unitStates.C_SR_001 = mastered; r.v12!.unitStates.C_SR_002 = mastered;
    r.v12!.currentGroupId = "SQG_SR_006A"; r.v12!.lastResult = "PASS";
    expect(selectV12Action(m, r, now)?.groupId).toBe("SQG_SR_006B");
    r.v12!.currentGroupId = "SQG_SR_004";
    expect(selectV12Action(m, r, now)?.groupId).not.toBe("SQG_SR_005");
    r.v12!.unitStates.M_SR_002 = mastered;
    expect(selectV12Action(m, r, now)?.groupId).toBe("SQG_SR_005");
  });
  it("executes target-specific automatic hint escalation", () => {
    let r = runtime(); r.v12!.pedagogicalStage = "KNOWLEDGE_CONSTRUCTION";
    r.currentTargetId = "M_SR_002"; r.currentQuestionId = "SQ_SR_004_A"; r.v12!.currentGroupId = "SQG_SR_004";
    r.v12!.noProgressCounts.M_SR_002 = 2; r.v12!.lastResult = "FAIL";
    const one = selectV12Action(m, r, now)!;
    expect(one.hintLevel).toBe(1);
    r = recordV12Action(r, one, now);
    expect(selectV12Action(m, r, now)?.hintLevel).toBe(2);
    expect(r.hintLevels.M_SR_003).toBeUndefined();
  });
  it("separates experience limit from mastery and normal Feynman admission", () => {
    const transition = nextV12Transition({ phase: "SOCRATIC", socraticTurns: 4, maxTurns: 5 }, { stage: "KNOWLEDGE_CONSTRUCTION", diagnosisFinished: true, constructionReady: false, transferPassed: false, majorError: false });
    expect(transition.stage).toBe("REFLECTION");
    expect(transition.experienceLimitReached).toBe(true);
    expect(constructionReady(initialV12State())).toBe(false);
  });
  it.each(m.cases.map((c) => c.id))("selects %s with only student-visible case text", (caseId) => {
    const r = runtime(); r.v12!.pedagogicalStage = "CASE_TRANSFER";
    r.usedCaseIds = m.cases.filter((c) => c.id !== caseId).map((c) => c.id);
    const action = selectV12Action(m, r, now)!;
    expect(action.caseId).toBe(caseId);
    expect(action.assistantMessage).not.toContain("围绕");
    expect(action.assistantMessage).not.toContain(m.cases[0].teacherData.excellentAnswer);
    expect(action.assistantMessage).toContain("教学合成案例");
  });
  it("falls back to a repeated case only after unseen cases are exhausted", () => {
    const r = runtime(); r.v12!.pedagogicalStage = "CASE_TRANSFER";
    r.usedCaseIds = m.cases.map((c) => c.id);
    expect(selectV12Action(m, r, now)?.caseId).toBeTruthy();
  });
  it("aggregates cross-session exposure without double-counting retry inheritance", () => {
    const first = runtime(); first.v12!.pedagogicalStage = "CASE_TRANSFER";
    const action = selectV12Action(m, first, now)!;
    const exposed = recordV12Action(first, action, now);
    const retry = mergeCaseExposureHistory(runtime(), [exposed]);
    const fresh = mergeCaseExposureHistory(runtime(), [exposed, retry]);
    fresh.v12!.pedagogicalStage = "CASE_TRANSFER";
    expect(fresh.caseExposureCounts[action.caseId!]).toBe(1);
    expect(selectV12Action(m, fresh, now)?.caseId).not.toBe(action.caseId);
  });
  it("does not downgrade a confirmed error from low-confidence evidence", () => {
    let r = answer(runtime(), ["systemic_equals_systematic"], 0);
    r = answer(r, ["systemic_equals_systematic"], 1);
    const id = "ERR_E01_SYSTEMIC_SYSTEMATIC_CONFUSION";
    expect(r.v12!.misconceptionStates[id].status).toBe("CONFIRMED");
    r = answer(r, ["systemic_equals_systematic"], 2, 0.3);
    expect(r.v12!.misconceptionStates[id].status).toBe("CONFIRMED");
  });
  it("aggregates L1-L4 independently from phase", () => {
    const s = initialV12State(); expect(aggregateDiagnosticLevel(s)).toBe("L1");
    const mastered = { status: "MASTERED" as const, evidenceRefs: [], independentEvidenceCount: 2, verificationCount: 1, questionIds: ["a", "b"], lastUpdatedAt: now };
    s.unitStates.C_SR_001 = mastered; expect(aggregateDiagnosticLevel(s)).toBe("L2");
    s.unitStates.M_SR_001 = mastered; s.unitStates.M_SR_002 = mastered; expect(aggregateDiagnosticLevel(s)).toBe("L3");
    s.transferPassed = true; s.observations.push({ evidenceId: "functional_impairment", independent: true, confidence: 0.9, ref: { messageId: "m", startOffset: 0, endOffset: 2, extractedText: "证据" } });
    expect(aggregateDiagnosticLevel(s)).toBe("L4");
  });
  it.each([["ERR_E01_SYSTEMIC_SYSTEMATIC_CONFUSION", "systemic_equals_systematic", 25, 100], ["ERR_E02_EVENT_EQUALS_SYSTEMIC", "event_equals_systemic", 50, 50], ["ERR_E06_MICRO_SAFE_EQUALS_SYSTEM_SAFE", "micro_safe_equals_system_safe", 100, 75]])("caps final confirmed %s and removes the cap after resolution", (id, evidenceId, conceptCap, transferCap) => {
    const r = runtime(); const s = r.v12!;
    const text = "这是最终自主回答及其概念解释、完整因果链、条件修订的证据。";
    const ref = { messageId: "final", startOffset: 0, endOffset: text.length, extractedText: text };
    s.finalFeynmanMessageId = "final"; s.transferPassed = true;
    s.misconceptionStates[String(id)] = { claimId: String(id), status: "CONFIRMED", modelAssessmentConfidence: 0.9, evidenceConsistency: 1, verificationCount: 2, contradictionCount: 0, systemConfidence: 0.9, evidenceRefs: [ref] };
    const positiveIds = Object.keys(m.v12!.evidenceDefinitions).filter((e) => !Object.values(m.v12!.errors).some((err) => err.evidenceId === e));
    s.observations = [...positiveIds, String(evidenceId)].map((e) => ({ evidenceId: e, ref, independent: true, confidence: 0.9 }));
    const messages = [{ id: "final", role: "USER", content: text }];
    const capped = buildV12Report(m, r, messages);
    expect(capped.report.dimensions.conceptCompleteness.score).toBeLessThanOrEqual(Number(conceptCap));
    expect(capped.report.dimensions.transferAbility.score).toBeLessThanOrEqual(Number(transferCap));
    s.finalRevisionMessageId = "revision";
    s.observations.push(...positiveIds.map((e) => ({ evidenceId: e, ref: { ...ref, messageId: "revision" }, independent: true, confidence: 0.9 })));
    const resolved = buildV12Report(m, r, [...messages, { id: "revision", role: "USER", content: text }]);
    expect(resolved.report.dimensions.conceptCompleteness.score).toBe(100);
    expect(s.misconceptionStates[String(id)].status).toBe("RESOLVED");
    expect(Object.values(resolved.evidenceLinks).every((refs) => refs.length > 0)).toBe(true);
  });
  it("rejects missing messages in the final evidence window", () => {
    const r = runtime(); r.v12!.finalRevisionMessageId = "missing";
    expect(() => buildV12Report(m, r, [])).toThrow(/window/);
  });
});
