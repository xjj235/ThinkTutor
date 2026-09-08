import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { createVersionSnapshot } from "@/lib/knowledge/releases";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { applyV12Assessment, recordV12Action, selectV12Action } from "@/lib/knowledge/v12-engine";
import { buildV12TurnFeedback } from "@/lib/knowledge/turn-feedback";
import type { KnowledgeRuntime } from "@/lib/knowledge/runtime-schemas";

const manifest = buildV12Manifest();
const now = "2026-09-07T10:00:00.000Z";
function diagnostic(): KnowledgeRuntime {
  const runtime = initialKnowledgeRuntime(createVersionSnapshot(manifest));
  return recordV12Action(runtime, selectV12Action(manifest, runtime, now)!, now);
}
function assess(runtime: KnowledgeRuntime, content: string, evidenceIds: string[], confidence = 0.9) {
  return applyV12Assessment(manifest, runtime, {
    evidence: evidenceIds.map((evidenceId) => ({ evidenceId, messageId: "answer", extractedText: content })),
    candidateMastery: [], candidateMisconceptions: [], candidateGaps: [], contradictions: [], recommendTransition: false, modelAssessmentConfidence: confidence,
  }, { id: "answer", content }, now);
}

describe("knowledge-grounded turn feedback", () => {
  beforeEach(() => vi.stubEnv("ALLOW_DRAFT_KNOWLEDGE", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("retains an actual answer reference and identifies the missing evidence without awarding mastery", () => {
    const before = diagnostic();
    const content = "我的理解是研究金融体系，而不是只看某一家机构的情况。";
    const after = assess(before, content, ["financial_system_scope"]);
    const snapshot = structuredClone(after);
    const feedback = buildV12TurnFeedback(manifest, before, after, "answer");
    expect(feedback).toContain(content);
    expect(feedback).toContain(manifest.v12!.evidenceDefinitions.financial_system_scope);
    expect(feedback).toContain("至少澄清一项");
    expect(feedback).toContain(manifest.v12!.evidenceDefinitions.functional_impairment);
    expect(feedback).not.toContain("本轮证据已覆盖");
    expect(after).toEqual(snapshot);
    expect(after.v12!.unitStates.C_SR_001.status).not.toBe("MASTERED");
  });

  it("distinguishes a successful answer from stable mastery", () => {
    const before = diagnostic();
    const after = assess(before, "金融体系中的冲击可以向其他机构传播，影响它们的经营。", ["financial_system_scope", "propagation"]);
    const feedback = buildV12TurnFeedback(manifest, before, after, "answer");
    expect(feedback).toContain("本轮证据已覆盖当前问题的要求");
    expect(feedback).toContain("稳定掌握仍以多次独立核验为准");
    expect(feedback).not.toContain("下一步需要补充");
  });

  it("does not promote ambiguous evidence or call an unverified claim a confirmed error", () => {
    const before = diagnostic();
    const after = assess(before, "金融体系的风险和单个机构的风险，我现在还不能准确区分。", ["financial_system_scope"], 0.3);
    const feedback = buildV12TurnFeedback(manifest, before, after, "answer");
    expect(feedback).toContain("本轮证据仍需核验");
    expect(feedback).not.toContain("本轮相关依据");
    expect(feedback).not.toContain("本轮证据已覆盖");
    const mistaken = assess(before, "一家银行倒闭就是系统性风险。", ["event_equals_systemic"]);
    expect(buildV12TurnFeedback(manifest, before, mistaken, "answer")).toContain("适用边界仍需核实");
    expect(mistaken.v12!.misconceptionStates.ERR_E02_EVENT_EQUALS_SYSTEMIC.status).toBe("CANDIDATE");
  });

  it("uses only this answer's validated observations and escapes student formatting", () => {
    const before = diagnostic();
    const content = "金融体系 [链接](https://example.test) <b>文字</b> " + "边界需要核实。".repeat(30);
    const after = assess(before, content, ["financial_system_scope"]);
    const feedback = buildV12TurnFeedback(manifest, before, after, "answer");
    expect(feedback).toContain("\\[链接\\]");
    expect(feedback).not.toContain("[链接](https://example.test)");
    expect(feedback).not.toContain("<b>");
    expect(feedback.length).toBeLessThan(500);
    after.v12!.observations.forEach((item) => { item.ref.messageId = "another-answer"; });
    expect(buildV12TurnFeedback(manifest, before, after, "answer")).not.toContain("原文依据");
    expect(buildV12TurnFeedback(manifest, before, after, "missing-answer")).toBe("");
    for (const item of manifest.cases) expect(feedback).not.toContain(item.teacherData.excellentAnswer);
  });

  it("uses distinct knowledge-specific scaffolds for diagnostic hints", () => {
    const before = diagnostic();
    const first = selectV12Action(manifest, before, now, true)!;
    const after = recordV12Action(before, first, now);
    const second = selectV12Action(manifest, after, now, true)!;
    expect(first.assistantMessage).not.toBe(second.assistantMessage);
    for (const hint of [first, second]) expect(manifest.hints.some((item) => item.hintText === hint.assistantMessage)).toBe(true);
    expect(after.targetAttempts).toEqual(before.targetAttempts);
    expect(after.v12!.unitStates).toEqual(before.v12!.unitStates);
  });
});
