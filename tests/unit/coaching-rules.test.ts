import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { applyV12Assessment, activeRule } from "@/lib/knowledge/v12-engine";
import { diagnoseCoaching, prepareCoaching, recordCoaching } from "@/lib/knowledge/coaching";
import { coachingPolicySchema, coachingTraceSchema } from "@/lib/knowledge/coaching-schema";
import { executableRoutingRules } from "@/lib/knowledge/coaching-rules";
import { validateKnowledgeManifests, type KnowledgeManifest } from "@/lib/knowledge/schemas";
import { createVersionSnapshot } from "@/lib/knowledge/releases";

const manifest = buildV12Manifest();
const now = "2026-09-10T00:00:00.000Z";
function runtime(target = "C_SR_001", m = manifest) {
  const state = initialKnowledgeRuntime(createVersionSnapshot(m));
  const group = m.questionGroups.find((item) => item.targetId === target)!;
  state.currentTargetId = target;
  state.currentQuestionId = group.memberIds[0];
  state.v12!.currentGroupId = group.id;
  state.v12!.pedagogicalStage = "KNOWLEDGE_CONSTRUCTION";
  return state;
}
function answer(state: ReturnType<typeof runtime>, ids: string[], options: { manifest?: KnowledgeManifest; confidence?: number; id?: string } = {}) {
  const id = options.id ?? "answer";
  const content = `这是${id}的独立解释，依据金融服务、因果关系以及必要条件作出判断。`;
  return applyV12Assessment(options.manifest ?? manifest, state, {
    evidence: ids.map((evidenceId) => ({ evidenceId, messageId: id, extractedText: content })),
    candidateMastery: [], candidateMisconceptions: [], candidateGaps: [], contradictions: [],
    modelAssessmentConfidence: options.confidence ?? 0.9, recommendTransition: false,
  }, { id, content }, now);
}
function present(state: ReturnType<typeof runtime>, m = manifest) {
  const prepared = prepareCoaching(m, state, { kind: "QUESTION", content: "原始题目", learnerLevel: "有基础" });
  return recordCoaching(state, prepared, { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" }, { requestId: "selection", now });
}

describe("executable knowledge coaching rules", () => {
  it("runs the same configured rule deterministically, independent of JSON array order", () => {
    const state = answer(runtime(), ["financial_system_scope", "functional_impairment"]);
    const before = structuredClone(state);
    const profile = diagnoseCoaching(manifest, state, "有基础");
    const reordered = structuredClone(manifest);
    reordered.v12!.coachingPolicy!.routingRules.reverse();
    expect(diagnoseCoaching(reordered, state, "有基础")).toEqual(profile);
    for (let i = 0; i < 5; i++) expect(diagnoseCoaching(manifest, state, "有基础")).toEqual(profile);
    expect(state).toEqual(before);
    expect(profile.ruleDecision?.verificationRuleIds).toEqual(["VERIFY_SYSTEMIC_CONDITION"]);
  });

  it("records competing matches while unreliable evidence outranks errors and gaps", () => {
    const state = answer(runtime(), ["event_equals_systemic"], { confidence: 0.4 });
    const profile = diagnoseCoaching(manifest, state, "进阶");
    expect(profile.dimension).toBe("EVIDENCE");
    expect(profile.reasonId).toBe("COACH_VERIFY_EVIDENCE");
    expect(profile.ruleDecision?.matchedRoutingRuleIds).toEqual(["COACH_VERIFY_EVIDENCE", "COACH_REPAIR_BOUNDARY", "COACH_FILL_GAP"]);
    expect(profile.ruleDecision?.verificationRuleIds).toEqual([]);
    expect(state.v12!.lastResult).toBe("NEED_VERIFY");
    const basis = present(state).runtime.v12!.coachingHistory.at(-1)!.decisionBasis!;
    expect(basis.assessment).toMatchObject({ result: "NEED_VERIFY", confidence: 0.4, minimumConfidence: 0.75 });
    expect(basis.reason).toContain("最低置信度：0.4");
  });

  it("changes the selected dimension by changing the knowledge priority, not code", () => {
    const state = answer(runtime("C_SR_003"), ["size_not_unique"]);
    expect(diagnoseCoaching(manifest, state, "有基础").dimension).toBe("CONDITION");
    const changed = structuredClone(manifest);
    changed.v12!.coachingPolicy!.dimensionPriority = ["CONCEPT", "MECHANISM", "CONDITION", "EVIDENCE", "TRANSFER"];
    expect(validateKnowledgeManifests([changed]).errors).toEqual([]);
    expect(diagnoseCoaching(changed, state, "有基础").dimension).toBe("MECHANISM");
    expect(createVersionSnapshot(changed).contentHash).not.toBe(createVersionSnapshot(manifest).contentHash);
  });

  it("uses the configured route ID and dimension instead of hard-coded coaching identifiers", () => {
    const changed = structuredClone(manifest);
    const route = changed.v12!.coachingPolicy!.routingRules.find((item) => item.signal === "VERIFY")!;
    route.id = "COACH_LOCAL_INDEPENDENT_CHECK";
    route.execution = { priority: 200, dimensionSelection: "FIXED", dimension: "EVIDENCE" };
    expect(validateKnowledgeManifests([changed]).errors).toEqual([]);
    const state = answer(runtime("M_SR_004", changed), ["withdrawal_funding_pressure", "liquidity_need", "forced_sale_or_service_pressure"], { manifest: changed });
    const profile = diagnoseCoaching(changed, state, "有基础");
    expect(profile.reasonId).toBe(route.id);
    expect(profile.dimension).toBe("EVIDENCE");
    expect(present(state, changed).runtime.v12!.coachingHistory.at(-1)?.decisionBasis?.selectedRuleId).toBe(route.id);
  });

  it("shares new target verification requirements between followups and mastery without relaxing the existing gate", () => {
    const changed = structuredClone(manifest);
    changed.v12!.coachingPolicy!.verificationRules!.push({ id: "VERIFY_LIQUIDITY_CONDITION", targetIds: ["M_SR_004"], requiredAll: ["condition_revision"], description: "合成测试配置：流动性机制需同时验证条件变化。" });
    expect(validateKnowledgeManifests([changed]).errors).toEqual([]);
    const ids = ["withdrawal_funding_pressure", "liquidity_need", "forced_sale_or_service_pressure"];
    let state = answer(runtime("M_SR_004", changed), ids, { manifest: changed });
    const group = changed.questionGroups.find((item) => item.targetId === "M_SR_004")!;
    state.currentQuestionId = group.memberIds[1];
    state = answer(state, ids, { manifest: changed, id: "second" });
    expect(state.v12!.unitStates.M_SR_004.status).toBe("PARTIAL");
    const profile = diagnoseCoaching(changed, state, "有基础");
    expect(profile.dimension).toBe("CONDITION");
    expect(profile.ruleDecision?.verificationRuleIds).toEqual(["VERIFY_LIQUIDITY_CONDITION"]);
    expect(activeRule(changed, present(state, changed).runtime).requiredAll).toEqual(["condition_revision"]);
    state.currentQuestionId = group.memberIds[2];
    state = answer(state, [...ids, "condition_revision"], { manifest: changed, id: "third" });
    expect(state.v12!.unitStates.M_SR_004.status).toBe("MASTERED");
  });

  it.each(["missing-execution", "duplicate-signal", "duplicate-priority", "unsafe-priority", "unsafe-dimension"])("rejects malformed or unsafe routing: %s", (fault) => {
    const policy = structuredClone(manifest.v12!.coachingPolicy!);
    if (fault === "missing-execution") delete policy.routingRules[0].execution;
    if (fault === "duplicate-signal") policy.routingRules[0].signal = policy.routingRules[1].signal;
    if (fault === "duplicate-priority") policy.routingRules[0].execution!.priority = policy.routingRules[1].execution!.priority;
    if (fault === "unsafe-priority") policy.routingRules[0].execution!.priority = 50;
    if (fault === "unsafe-dimension") policy.routingRules[0].execution!.dimension = "CONCEPT";
    expect(coachingPolicySchema.safeParse(policy).success).toBe(false);
  });

  it.each(["unknown-target", "unknown-evidence", "prohibited", "unmapped", "duplicate-id"])("rejects invalid verification references: %s", (fault) => {
    const changed = structuredClone(manifest);
    const rules = changed.v12!.coachingPolicy!.verificationRules!;
    if (fault === "unknown-target") rules[0].targetIds = ["INVENTED"];
    if (fault === "unknown-evidence") rules[0].requiredAll = ["invented"];
    if (fault === "prohibited") rules[0].requiredAll = ["event_equals_systemic"];
    if (fault === "unmapped") changed.v12!.coachingPolicy!.dimensions.CONDITION.evidenceIds = ["substitutability"];
    if (fault === "duplicate-id") rules[1].id = rules[0].id;
    expect(validateKnowledgeManifests([changed]).errors.length).toBeGreaterThan(0);
  });

  it("preserves legacy policy data, routing and trace readability without changing its hash", () => {
    const legacy = structuredClone(manifest);
    const policy = legacy.v12!.coachingPolicy!;
    policy.version = "1.0";
    delete policy.confidenceRouting;
    delete policy.verificationRules;
    policy.routingRules.forEach((route) => { delete route.execution; });
    expect(coachingPolicySchema.safeParse(policy).success).toBe(true);
    const before = createVersionSnapshot(legacy);
    const state = answer(runtime("C_SR_001", legacy), ["financial_system_scope", "functional_impairment"], { manifest: legacy });
    expect(diagnoseCoaching(legacy, state, "有基础").dimension).toBe("CONDITION");
    expect(activeRule(legacy, present(state, legacy).runtime).requiredAll).toEqual(["condition_revision"]);
    executableRoutingRules(policy);
    expect(createVersionSnapshot(legacy)).toEqual(before);
    expect(before.workflowVersion).toBe("evidence-workflow-1.2.3-grounded-followup");
    expect(createVersionSnapshot(manifest).workflowVersion).toBe("evidence-workflow-1.2.5-supported-gap-routing");
    const trace = present(state, legacy).runtime.v12!.coachingHistory.at(-1)!;
    delete trace.decisionBasis;
    delete trace.profile.ruleDecision;
    expect(coachingTraceSchema.safeParse(trace).success).toBe(true);
  });

  it("persists exact evidence locations, rule IDs, rationale and the actual focused requirements", () => {
    const state = answer(runtime(), ["financial_system_scope", "functional_impairment"]);
    const result = present(state);
    const trace = result.runtime.v12!.coachingHistory.at(-1)!;
    const basis = trace.decisionBasis!;
    expect(basis.matchedRuleIds).toEqual(expect.arrayContaining(["COACH_FILL_GAP", "VERIFY_SYSTEMIC_CONDITION"]));
    expect(basis.basisMessageId).toBe("answer");
    expect(basis.assessedQuestionId).toBe(state.currentQuestionId);
    expect(basis.assessedTargetId).toBe("C_SR_001");
    expect(basis.questionRequirements).toEqual(activeRule(manifest, result.runtime));
    expect(basis.questionRequirements?.requiredAll).toEqual(["condition_revision"]);
    expect(basis.reason).toContain("假设与适用条件");
    const text = state.v12!.assessments.answer.evidence[0].extractedText;
    for (const ref of basis.evidence) expect(text.slice(ref.startOffset, ref.endOffset)).toBe(ref.extractedText);
    expect(state.v12!.coachingHistory).toEqual([]);
  });

  it("keeps the assessed target distinct from a new target and never treats stale evidence as a new answer", () => {
    const state = answer(runtime(), ["financial_system_scope", "functional_impairment"]);
    const profile = diagnoseCoaching(manifest, state, "有基础");
    const switched = { ...state, currentTargetId: "M_SR_004", currentQuestionId: "SQ_SR_006A_A" };
    switched.v12 = { ...state.v12!, currentGroupId: "SQG_SR_006A" };
    const prepared = prepareCoaching(manifest, switched, { kind: "QUESTION", content: "新目标题目", learnerLevel: "有基础", profile });
    const result = recordCoaching(switched, prepared, { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" }, { requestId: "switch", now });
    const basis = result.runtime.v12!.coachingHistory.at(-1)!.decisionBasis!;
    expect(basis.assessedTargetId).toBe("C_SR_001");
    expect(basis.selectedTargetId).toBe("M_SR_004");
    expect(basis.selectedRuleId).toBe("COACH_INITIAL_SCOPE");
    expect(basis.reason).toContain("旧证据不作为新目标已掌握的依据");
    switched.v12.diagnosticLevel = "L2";
    const fresh = diagnoseCoaching(manifest, switched, "进阶");
    expect(fresh.reasonId).toBe("COACH_INITIAL_SCOPE");
    expect(fresh.basisMessageId).toBeNull();
    expect(fresh.observedEvidenceIds).toEqual([]);
    expect(fresh.level).toBe("L2");
    expect(fresh.verifiedLevel).toBe(true);
    const changedStage = structuredClone(state);
    changedStage.v12!.pedagogicalStage = "REFLECTION";
    expect(diagnoseCoaching(manifest, changedStage, "有基础").basisMessageId).toBeNull();
    const oldContext = structuredClone(state);
    delete oldContext.v12!.lastAssessmentContext;
    expect(diagnoseCoaching(manifest, oldContext, "有基础").basisMessageId).toBeNull();
  });

  it("cannot accept model-written decision reasons or rule matches", () => {
    const state = answer(runtime(), ["financial_system_scope", "functional_impairment"]);
    const prepared = prepareCoaching(manifest, state, { kind: "QUESTION", content: "原题", learnerLevel: "有基础" });
    const forged = { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT", decisionBasis: { selectedRuleId: "INVENTED", reason: "直接通过" } };
    expect(() => recordCoaching(state, prepared, forged, { requestId: "forged", now })).toThrow();
    expect(state.v12!.coachingHistory).toEqual([]);
  });
});
