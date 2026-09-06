import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { applyV12Assessment, criticalStepRule, diagnosticFinished, evaluateEvidenceRule, selectV12Action, recordV12Action } from "@/lib/knowledge/v12-engine";
import { validateKnowledgeManifests } from "@/lib/knowledge/schemas";
import { modelTurnAssessmentSchema, tutorResponseSchema, type TurnAssessment } from "@/lib/knowledge/v12-schema";
import { applicablePedagogyRules } from "@/lib/knowledge/pedagogy";
import { buildV12Report } from "@/lib/knowledge/v12-report";
import { nextV12Transition } from "@/lib/state-machine";

const manifest = buildV12Manifest();
const now = "2026-09-06T00:00:00.000Z";
const version = { releaseId: "KR_SR_1_2", contentHash: "a".repeat(64), knowledgeVersion: "1.2", diagnosticVersion: "1.2", questionGraphVersion: "1.2", caseBankVersion: "1.2", rubricVersion: "1.2", promptVersion: "1.2", workflowVersion: "1.2", schemaVersion: "1.2" as const, modelProvider: "mock" as const, modelName: "mock" };
const prohibited = new Set([...Object.values(manifest.v12!.unitRules), ...Object.values(manifest.v12!.relationRules)].flatMap((r) => r.prohibited));
const positive = Object.keys(manifest.v12!.evidenceDefinitions).filter((id) => !prohibited.has(id));
function assess(ids: string[], index = 0, confidence = 0.9, contradictions: string[] = []) {
  const message = { id: `matrix-${index}`, content: `工程证据夹具第${index}条，仅验证服务端规则，不代表真实学生或教师审核。` };
  const assessment: TurnAssessment = { evidence: ids.map((evidenceId) => ({ evidenceId, messageId: message.id, extractedText: message.content })), candidateMisconceptions: [], candidateGaps: [], candidateMastery: [], modelAssessmentConfidence: confidence, contradictions, recommendTransition: true };
  return { message, assessment };
}
function caseRuntime(caseId: string) {
  const r = initialKnowledgeRuntime(version);
  r.v12!.pedagogicalStage = "CASE_TRANSFER"; r.v12!.currentCaseId = caseId; r.v12!.currentCaseUnseen = true;
  r.currentTargetId = "COMP_SR_TRANSFER"; r.currentQuestionId = `CASE_QUESTION_${caseId}`;
  return r;
}
describe.each(manifest.cases.map((c) => c.id))("%s semantic evidence matrix", (caseId) => {
  const config = manifest.v12!.cases[caseId];
  it("requires every critical step and accepts a complete unseen answer", () => {
    const { message, assessment } = assess(positive);
    const result = applyV12Assessment(manifest, caseRuntime(caseId), assessment, message, now);
    expect(result.v12!.transferPassed).toBe(true);
    expect(result.v12!.lastResult).toBe("PASS");
  });
  it.each(config.criticalSteps)("rejects missing %s and selects its exact repair group", (step) => {
    const missing = criticalStepRule(manifest, step).requiredAll[0];
    const ids = positive.filter((id) => id !== missing);
    const { message, assessment } = assess(ids);
    const result = applyV12Assessment(manifest, caseRuntime(caseId), assessment, message, now);
    expect(result.v12!.transferPassed).toBe(false);
    const firstMissing = config.criticalSteps.find((id) => evaluateEvidenceRule(criticalStepRule(manifest, id), ids) !== "PASS")!;
    expect(result.v12!.currentGroupId).toBe(config.followUp[firstMissing]);
  });
  it.each(["low confidence", "contradiction", "seen case"])("cannot pass with %s", (mode) => {
    const r = caseRuntime(caseId);
    r.v12!.currentCaseUnseen = mode !== "seen case";
    const { message, assessment } = assess(positive, 1, mode === "low confidence" ? 0.3 : 0.9, mode === "contradiction" ? ["propagation"] : []);
    const result = applyV12Assessment(manifest, r, assessment, message, now);
    expect(result.v12!.transferPassed).toBe(false);
    if (mode !== "seen case") expect(result.v12!.lastResult).toBe("NEED_VERIFY");
  });
  it("retains unseen/variant preference and marks exhausted repeats as seen", () => {
    let r = caseRuntime(caseId); r.usedCaseIds = manifest.cases.filter((c) => c.id !== caseId).map((c) => c.id);
    const selected = selectV12Action(manifest, r, now)!;
    expect(selected.caseId).toBe(caseId);
    r = recordV12Action(r, selected, now);
    expect(r.v12!.currentCaseUnseen).toBe(true);
    r = recordV12Action(r, selectV12Action(manifest, r, now)!, now);
    expect(r.v12!.currentCaseUnseen).toBe(false);
  });
});
describe("diagnostic and contract boundaries", () => {
  it("an authenticity guard blocks progression even when earlier mastery is sufficient", () => {
    const transition = nextV12Transition({ phase: "SOCRATIC", socraticTurns: 2, maxTurns: 5 }, { stage: "KNOWLEDGE_CONSTRUCTION", diagnosisFinished: true, constructionReady: true, transferPassed: true, majorError: false, verificationRequired: true });
    expect(transition.stage).toBe("KNOWLEDGE_CONSTRUCTION"); expect(transition.socraticTurns).toBe(2);
  });
  it.each([0, 1, 2, 3, 15, 16])("does not exit after %i low-confidence answers", (count) => {
    let r = initialKnowledgeRuntime(version);
    for (let i = 0; i < count; i++) {
      r = recordV12Action(r, selectV12Action(manifest, r, now)!, now);
      const { message, assessment } = assess(positive, i, 0.3);
      r = applyV12Assessment(manifest, r, assessment, message, now);
    }
    expect(diagnosticFinished(r)).toBe(false);
    expect(selectV12Action(manifest, r, now)).not.toBeNull();
  });
  it("does not exit on a low-confidence or contradictory latest answer after stable mastery", () => {
    let r = initialKnowledgeRuntime(version);
    for (let i = 0; i < 5; i++) {
      r = recordV12Action(r, selectV12Action(manifest, r, now)!, now);
      const { message, assessment } = assess(positive, i);
      r = applyV12Assessment(manifest, r, assessment, message, now);
    }
    expect(diagnosticFinished(r)).toBe(true);
    for (const mode of ["low", "contradiction"]) {
      const { message, assessment } = assess(positive, 10, mode === "low" ? 0.3 : 0.9, mode === "contradiction" ? ["propagation"] : []);
      expect(diagnosticFinished(applyV12Assessment(manifest, r, assessment, message, now))).toBe(false);
    }
  });
  it("does not substitute fire-sale evidence for the common-exposure causal relation", () => {
    const rule = criticalStepRule(manifest, "REL_SR_003");
    expect(evaluateEvidenceRule(rule, manifest.v12!.unitRules.M_SR_003.requiredAll)).toBe("FAIL");
    expect(evaluateEvidenceRule(rule, ["shared_asset_loss"])).toBe("PARTIAL");
    const invalid = structuredClone(manifest); delete invalid.v12!.relationRules.REL_SR_003;
    expect(validateKnowledgeManifests([invalid]).errors.some((e) => e.includes("missing executable"))).toBe(true);
  });
  it("routes candidate gaps into final claims and teacher review", () => {
    const r = caseRuntime("CASE_SR_001");
    const { message, assessment } = assess([], 20, 0.3);
    const result = applyV12Assessment(manifest, r, assessment, message, now);
    result.v12!.finalRevisionMessageId = message.id;
    buildV12Report(manifest, result, [{ ...message, role: "USER" }]);
    expect(result.v12!.needsTeacherReview).toBe(true);
    expect(result.v12!.finalClaims).toEqual(expect.arrayContaining([expect.objectContaining({ type: "GAP", status: "CANDIDATE" })]));
    const priorities = applicablePedagogyRules(manifest.v12!, result.v12!).map((r) => r.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });
  it.each(["phase", "action", "target", "questionId", "caseId", "version", "mastered_points_delta", "missing_points_delta", "error_tags_delta", "modelAssessmentConfidence"])("rejects model authority field %s", (field) => {
    const { modelAssessmentConfidence: ignored, ...raw } = assess([]).assessment;
    expect(ignored).toBe(0.9);
    expect(modelTurnAssessmentSchema.safeParse({ ...raw, [field]: "forbidden" }).success).toBe(false);
    expect(tutorResponseSchema.safeParse({ assistantMessage: "一条问题", [field]: "forbidden" }).success).toBe(false);
  });
});
