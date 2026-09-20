import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { createVersionSnapshot } from "@/lib/knowledge/releases";
import { applyV12Assessment, diagnosticFinished, activeRule } from "@/lib/knowledge/v12-engine";
import { normalizeModelAssessment, type TurnAssessment } from "@/lib/knowledge/v12-schema";
import { diagnoseCoaching, prepareCoaching, recordCoaching } from "@/lib/knowledge/coaching";
import { coachingPolicySchema } from "@/lib/knowledge/coaching-schema";
import { validateKnowledgeManifests } from "@/lib/knowledge/schemas";
import { buildV12TurnFeedback } from "@/lib/knowledge/turn-feedback";

const manifest = buildV12Manifest();
const now = "2026-09-11T00:00:00.000Z";
// Preserve the failed real-model answer and candidates; only its message ID is normalized.
const message = { id: "scope-only", content: "系统性风险的研究对象是整个金融体系，不是单家银行的经营损失。目前我只说明了研究范围，还没有说明金融服务受到什么影响。" };
function assessment(confidence = 0.5): TurnAssessment {
  return normalizeModelAssessment({
    evidence: ["financial_system_scope", "single_event_not_sufficient"].map((evidenceId) => ({ evidenceId, messageId: message.id, extractedText: "系统性风险的研究对象是整个金融体系，不是单家银行的经营损失。" })),
    candidateMastery: [{ unitId: "C_SR_001", modelConfidence: confidence }],
    candidateGaps: [{ id: "GAP_DEFINITION_ONLY", modelConfidence: 0.9 }], candidateMisconceptions: [], contradictions: [], recommendTransition: false,
  });
}
function initial() {
  const state = initialKnowledgeRuntime(createVersionSnapshot(manifest));
  const question = manifest.diagnosticQuestions.find((q) => q.targetConcepts.includes("C_SR_001"))!;
  state.currentTargetId = "C_SR_001";
  state.currentQuestionId = question.id;
  state.v12!.currentGroupId = question.equivalentGroup;
  return state;
}
function assess(raw = assessment(), state = initial()) {
  return applyV12Assessment(manifest, state, raw, message, now);
}

describe("claim-specific confidence for followup routing", () => {
  it.each([0.5, 0.6])("replays the failed sample at %s without changing mastery or stage evidence", (confidence) => {
    const raw = assessment(confidence);
    if (confidence === 0.6) raw.candidateGaps.push({ id: "GAP_CAUSAL_CHAIN", modelConfidence: 0.85 });
    const state = assess(raw);
    const before = structuredClone(state);
    const profile = diagnoseCoaching(manifest, state, "有基础");
    expect(profile.dimension).toBe("MECHANISM");
    expect(profile.reasonId).toBe("COACH_FILL_GAP");
    expect(profile.ruleDecision?.supportedGap).toMatchObject({ ruleId: "ROUTE_SUPPORTED_DEFINITION_GAP", candidateGapId: "GAP_DEFINITION_ONLY", confidence: 0.9 });
    const prepared = prepareCoaching(manifest, state, { kind: "DIAGNOSIS", content: "原题", learnerLevel: "有基础", profile });
    const result = recordCoaching(state, prepared, { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" }, { requestId: "test", now }).runtime;
    const basis = result.v12!.coachingHistory.at(-1)!.decisionBasis!;
    expect(basis.assessment).toMatchObject({ result: "NEED_VERIFY", confidence, minimumConfidence: 0.75, supportedGap: { confidence: 0.9 } });
    expect(basis.matchedRuleIds).toContain("ROUTE_SUPPORTED_DEFINITION_GAP");
    expect(basis.reason).toContain("不改变评分或阶段门禁");
    expect(activeRule(manifest, result).requiredAny).toEqual(expect.arrayContaining(["functional_impairment", "propagation"]));
    expect(state).toEqual(before);
    expect(result.v12!.assessments).toEqual(before.v12!.assessments);
    expect(result.v12!.observations).toEqual(before.v12!.observations);
    expect(result.v12!.unitStates).toEqual(before.v12!.unitStates);
    expect(result.v12!.unitStates.C_SR_001.independentEvidenceCount).toBe(0);
    expect(result.v12!.unitStates.C_SR_001.status).not.toBe("MASTERED");
    expect(result.v12!.lastResult).toBe("NEED_VERIFY");
    expect(diagnosticFinished(result)).toBe(false);
    const feedback = buildV12TurnFeedback(manifest, initial(), state, message.id, profile.ruleDecision?.supportedGap);
    expect(feedback).toContain("尚不足以确认整体掌握");
    expect(feedback).not.toContain("本轮证据仍需核验");
  });

  it.each([0.749, 0.75])("uses the unchanged 0.75 threshold for the gap itself: %s", (confidence) => {
    const raw = assessment();
    raw.candidateGaps[0].modelConfidence = confidence;
    const profile = diagnoseCoaching(manifest, assess(raw), "有基础");
    expect(profile.dimension).toBe(confidence >= 0.75 ? "MECHANISM" : "EVIDENCE");
  });

  it.each(["uncertain-gap", "possible-error", "contradiction", "no-evidence", "wrong-gap", "wrong-mastery", "no-mastery", "aggregate-mismatch", "already-covered", "duplicate-gap"])("does not bypass uncertainty when %s", (fault) => {
    const raw = assessment();
    if (fault === "uncertain-gap") raw.candidateGaps[0].modelConfidence = 0.6;
    if (fault === "possible-error") raw.candidateMisconceptions = [{ id: Object.keys(manifest.v12!.errors)[0], modelConfidence: 0.9 }];
    if (fault === "contradiction") raw.contradictions = ["financial_system_scope"];
    if (fault === "no-evidence") raw.evidence = [];
    if (fault === "wrong-gap") raw.candidateGaps[0].id = Object.keys(manifest.v12!.gaps).find((id) => manifest.v12!.gaps[id] !== "C_SR_001")!;
    if (fault === "wrong-mastery") raw.candidateMastery[0].unitId = "C_SR_002";
    if (fault === "no-mastery") raw.candidateMastery = [];
    if (fault === "aggregate-mismatch") raw.modelAssessmentConfidence = 0.4;
    if (fault === "already-covered") raw.evidence.push({ ...raw.evidence[0], evidenceId: "functional_impairment" });
    if (fault === "duplicate-gap") raw.candidateGaps.push({ id: "GAP_DEFINITION_ONLY", modelConfidence: 0.6 });
    const profile = diagnoseCoaching(manifest, assess(raw), "有基础");
    expect(profile.dimension).toBe("EVIDENCE");
    expect(profile.ruleDecision?.supportedGap).toBeUndefined();
  });

  it.each(["hint", "copy", "low-effort", "case", "resume", "other-question", "other-stage", "unasked-gap"])("keeps hard verification when %s", (fault) => {
    let state = initial();
    if (fault === "hint") state.v12!.activityType = "HINT";
    if (fault === "copy") state = assess();
    const raw = assessment();
    if (fault === "copy") {
      const repeated = { ...message, id: "copy" };
      raw.evidence.forEach((item) => { item.messageId = repeated.id; });
      state = applyV12Assessment(manifest, state, raw, repeated, now);
    } else state = assess(raw, state);
    if (fault === "low-effort") state.flags.push("FLAG_LOW_EFFORT");
    if (fault === "case") state.v12!.currentCaseId = "CASE_SR_001";
    if (fault === "resume") state.v12!.resumeVerification = { stage: "DIAGNOSIS", activityType: "DIAGNOSTIC_QUESTION", questionId: state.currentQuestionId, targetId: state.currentTargetId, groupId: state.v12!.currentGroupId, caseId: null, assistantMessage: "恢复核验", requestedAt: now };
    if (fault === "other-question") state.currentQuestionId = "different-question";
    if (fault === "other-stage") state.v12!.pedagogicalStage = "REFLECTION";
    if (fault === "unasked-gap") state.v12!.coachingPrompt = { questionId: state.currentQuestionId, stage: "DIAGNOSIS", text: "请说明表述依据", rule: { requiredAll: ["clear_expression"], requiredAny: [], prohibited: [] } };
    const profile = diagnoseCoaching(manifest, state, "有基础");
    expect(profile.ruleDecision?.supportedGap).toBeUndefined();
    expect(profile.reasonId).toBe(["other-question", "other-stage"].includes(fault) ? "COACH_INITIAL_SCOPE" : "COACH_VERIFY_EVIDENCE");
  });

  it("preserves 1.1 routing and hashes and validates the version boundary", () => {
    const legacy = structuredClone(manifest);
    legacy.v12!.coachingPolicy!.version = "1.1";
    expect(coachingPolicySchema.safeParse(legacy.v12!.coachingPolicy).success).toBe(false);
    delete legacy.v12!.coachingPolicy!.confidenceRouting;
    expect(validateKnowledgeManifests([legacy]).errors).toEqual([]);
    const snapshot = createVersionSnapshot(legacy);
    expect(diagnoseCoaching(legacy, assess(), "有基础").dimension).toBe("EVIDENCE");
    expect(createVersionSnapshot(legacy)).toEqual(snapshot);
    expect(snapshot.workflowVersion).toBe("evidence-workflow-1.2.4-executable-coaching");
    expect(createVersionSnapshot(manifest).contentHash).not.toBe(snapshot.contentHash);
  });

  it.each(["missing-policy", "wrong-target", "overlap", "duplicate-id", "unmapped"])("rejects invalid knowledge confidence rules: %s", (fault) => {
    const changed = structuredClone(manifest);
    const rules = changed.v12!.coachingPolicy!.confidenceRouting!.rules;
    if (fault === "missing-policy") delete changed.v12!.coachingPolicy!.confidenceRouting;
    if (fault === "wrong-target") rules[0].targetId = "C_SR_002";
    if (fault === "overlap") rules[0].absentAll.push(rules[0].requiredAll[0]);
    if (fault === "duplicate-id") rules.push(structuredClone(rules[0]));
    if (fault === "unmapped") rules[0].absentAll = ["event_equals_systemic"];
    expect(validateKnowledgeManifests([changed]).errors.length).toBeGreaterThan(0);
  });
});
