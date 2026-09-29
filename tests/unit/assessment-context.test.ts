import { describe, expect, it } from "vitest";
import { buildAssessmentRules, resolveAssessmentTarget } from "@/lib/knowledge/assessment-context";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";

const manifest = buildV12Manifest();
function reflectionRuntime() {
  const runtime = initialKnowledgeRuntime({ releaseId: "KR_SR_1_2", contentHash: "a".repeat(64), knowledgeVersion: "1.2", diagnosticVersion: "1.2", questionGraphVersion: "1.2", caseBankVersion: "1.2", rubricVersion: "1.2", promptVersion: "test", workflowVersion: "test", schemaVersion: "1.2", modelProvider: "mock", modelName: "mock" });
  runtime.currentTargetId = "COMP_SR_TRANSFER";
  runtime.v12!.pedagogicalStage = "REFLECTION";
  runtime.v12!.reflectionTargetId = "M_SR_002";
  return runtime;
}

describe("assessment target resolution", () => {
  it("uses the already-selected reflection target without mutating the runtime", () => {
    const runtime = reflectionRuntime();
    expect(resolveAssessmentTarget(manifest, runtime)).toBe("M_SR_002");
    expect(buildAssessmentRules(manifest, runtime)).toMatchObject({ M_SR_002: manifest.v12!.unitRules.M_SR_002, CURRENT_QUESTION: manifest.v12!.unitRules.M_SR_002 });
    expect(buildAssessmentRules(manifest, runtime).COMP_SR_TRANSFER).toBeUndefined();
    expect(runtime.currentTargetId).toBe("COMP_SR_TRANSFER");
  });

  it("preserves the recovery target while verification interrupts a reflection", () => {
    const runtime = reflectionRuntime();
    runtime.currentTargetId = "C_SR_001";
    runtime.v12!.resumeVerification = { stage: "REFLECTION", activityType: "REFLECTION_REVISION", questionId: null, targetId: "M_SR_002", groupId: null, caseId: null, assistantMessage: "继续共同暴露的反思", requestedAt: "2026-09-29T00:00:00Z" };
    expect(resolveAssessmentTarget(manifest, runtime)).toBe("C_SR_001");
    expect(buildAssessmentRules(manifest, runtime).CURRENT_QUESTION).toEqual(manifest.v12!.unitRules.C_SR_001);
  });

  it("does not reuse a reflection target in another stage or invent an unknown target", () => {
    const runtime = reflectionRuntime();
    runtime.v12!.pedagogicalStage = "FEYNMAN_OUTPUT";
    expect(resolveAssessmentTarget(manifest, runtime)).toBe("COMP_SR_TRANSFER");
    runtime.v12!.pedagogicalStage = "REFLECTION";
    runtime.v12!.reflectionTargetId = "unknown";
    expect(resolveAssessmentTarget(manifest, runtime)).toBe("COMP_SR_TRANSFER");
  });
});
