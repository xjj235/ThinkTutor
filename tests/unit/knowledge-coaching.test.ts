import { describe, expect, it } from "vitest";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { activeRule, applyV12Assessment } from "@/lib/knowledge/v12-engine";
import { diagnoseCoaching, prepareCoaching, recordCoaching } from "@/lib/knowledge/coaching";
import { validateKnowledgeManifests } from "@/lib/knowledge/schemas";
import { createTeachingDecisionSchema } from "@/lib/ai/teaching-schema";
import { buildV12Report } from "@/lib/knowledge/v12-report";

const m = buildV12Manifest();
const now = "2026-09-07T16:00:00.000Z";
function state(target = "C_SR_001") {
  const r = initialKnowledgeRuntime({ releaseId: "KR_SR_1_2", contentHash: "a".repeat(64), knowledgeVersion: "1.2", diagnosticVersion: "1.2", questionGraphVersion: "1.2", caseBankVersion: "1.2", rubricVersion: "1.2", promptVersion: "test", workflowVersion: "test", schemaVersion: "1.2", modelProvider: "mock", modelName: "mock" });
  const group = m.questionGroups.find((g) => g.targetId === target)!;
  r.currentTargetId = target; r.currentQuestionId = group.memberIds[0];
  r.v12!.pedagogicalStage = "KNOWLEDGE_CONSTRUCTION"; r.v12!.currentGroupId = group.id;
  return r;
}
function answer(r: ReturnType<typeof state>, ids: string[], confidence = 0.9, id = "answer") {
  const content = `这是${id}的独立解释，陈述概念、因果联系及适用条件。`;
  return applyV12Assessment(m, r, { evidence: ids.map((evidenceId) => ({ evidenceId, messageId: id, extractedText: content })), candidateMastery: [], candidateMisconceptions: [], candidateGaps: [], contradictions: [], modelAssessmentConfidence: confidence, recommendTransition: false }, { id, content }, now);
}

describe("knowledge-bounded adaptive coaching", () => {
  it("has at least twelve distinct forms covering all dimensions and levels", () => {
    const policy = m.v12!.coachingPolicy!;
    expect(policy.forms).toHaveLength(15);
    expect(validateKnowledgeManifests([m]).errors).toEqual([]);
    const damaged = structuredClone(m);
    damaged.v12!.coachingPolicy!.scoreCriteria.logicCompleteness[0] = ["invented"];
    damaged.v12!.coachingPolicy!.stageFrames.CASE[0].template = "Changed knowledge content";
    expect(validateKnowledgeManifests([damaged]).errors.join(" ")).toMatch(/unknown evidence/);
    expect(validateKnowledgeManifests([damaged]).errors.join(" ")).toMatch(/locked content/);
  });

  it.each([
    ["C_SR_002", ["systemic_scope", "systematic_market_factor"], 0.9, "CONCEPT"],
    ["M_SR_004", ["withdrawal_funding_pressure"], 0.9, "MECHANISM"],
    ["C_SR_001", ["financial_system_scope", "functional_impairment"], 0.9, "CONDITION"],
    ["M_SR_004", ["withdrawal_funding_pressure"], 0.4, "EVIDENCE"],
    ["M_SR_004", ["withdrawal_funding_pressure", "liquidity_need", "forced_sale_or_service_pressure"], 0.9, "TRANSFER"],
  ] as const)("diagnoses the missing dimension for %s", (target, ids, confidence, expected) => {
    const r = answer(state(target), [...ids], confidence);
    expect(diagnoseCoaching(m, r, "进阶").dimension).toBe(expected);
  });

  it("uses declared level only for initial presentation, not as evidence of mastery", () => {
    const r = state();
    const profile = diagnoseCoaching(m, r, "进阶");
    expect(profile.level).toBe("L3");
    expect(profile.verifiedLevel).toBe(false);
    expect(profile.observedEvidenceIds).toEqual([]);
    expect(r.v12!.unitStates).toEqual({});
  });

  it("asks beginners for a changed judgment when the rule requires condition revision", () => {
    const r = answer(state(), ["financial_system_scope", "functional_impairment"]);
    const prepared = prepareCoaching(m, r, { kind: "QUESTION", content: "原题", learnerLevel: "入门" });
    const form = prepared.input.choices.find((choice) => choice.id === "FORM_CONDITION_01")!;
    expect(form.template).toContain("如果去掉");
    expect(form.template).toContain("原判断会怎样变化");
    const next = recordCoaching(r, prepared, { choiceId: form.id, openingId: "OPEN_DIRECT" }, { requestId: "beginner-condition", now }).runtime;
    expect(activeRule(m, next).requiredAll).toEqual(["condition_revision"]);
  });

  it("rejects out-of-scope choices, invented facts and model-supplied scores", () => {
    const r = answer(state("M_SR_004"), ["withdrawal_funding_pressure"]);
    const prepared = prepareCoaching(m, r, { kind: "QUESTION", content: "原题", learnerLevel: "入门" });
    const decision = { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" };
    const schema = createTeachingDecisionSchema(prepared.input);
    expect(schema.safeParse(decision).success).toBe(true);
    for (const invalid of [{ ...decision, choiceId: "FORM_CONCEPT_01" }, { ...decision, assistantMessage: "伪造知识" }, { ...decision, score: 100 }, { ...decision, phase: "COMPLETED" }]) expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("does not offer an already used form when another eligible form exists", () => {
    const r = answer(state("M_SR_004"), ["withdrawal_funding_pressure"]);
    const options = { kind: "QUESTION" as const, content: "原题", learnerLevel: "入门" };
    const prepared = prepareCoaching(m, r, options);
    const decision = { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" };
    const next = recordCoaching(r, prepared, decision, { requestId: "first", now }).runtime;
    const second = prepareCoaching(m, next, options);
    expect(second.input.choices.every((c) => c.id !== decision.choiceId)).toBe(true);
    expect(createTeachingDecisionSchema(second.input).safeParse(decision).success).toBe(false);
  });

  it("scores a focused question against its own scope without inventing full-target mastery", () => {
    const r = answer(state("M_SR_004"), ["withdrawal_funding_pressure"]);
    const prepared = prepareCoaching(m, r, { kind: "QUESTION", content: "原题", learnerLevel: "入门" });
    const selected = recordCoaching(r, prepared, { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" }, { requestId: "focus", now });
    expect(activeRule(m, selected.runtime).requiredAll).toEqual(["liquidity_need", "forced_sale_or_service_pressure"]);
    const next = answer(selected.runtime, ["liquidity_need", "forced_sale_or_service_pressure"], 0.9, "followup");
    expect(next.v12!.lastResult).toBe("PASS");
    expect(next.v12!.unitStates.M_SR_004.status).toBe("PARTIAL");
    expect(next.v12!.gapStates.GAP_LIQUIDITY_MECHANISM.status).not.toBe("RESOLVED");
  });

  it("selects the latest assessment by explicit message ID, independent of JSONB key order", () => {
    let r = answer(state("M_SR_004"), ["withdrawal_funding_pressure"], 0.9, "z-old");
    r = answer(r, ["withdrawal_funding_pressure", "liquidity_need", "forced_sale_or_service_pressure"], 0.9, "a-new");
    const reordered = structuredClone(r);
    reordered.v12!.assessments = Object.fromEntries(Object.entries(r.v12!.assessments).reverse());
    expect(diagnoseCoaching(m, reordered, "入门")).toEqual(diagnoseCoaching(m, r, "入门"));
    expect(diagnoseCoaching(m, reordered, "入门").basisMessageId).toBe("a-new");
  });

  it("does not equate shared terminology with copying, but rejects repeated whole answers", () => {
    const quote = "金融体系";
    const apply = (r: ReturnType<typeof state>, id: string, content: string) => applyV12Assessment(m, r, { evidence: [{ evidenceId: "financial_system_scope", messageId: id, extractedText: quote }], candidateMastery: [], candidateMisconceptions: [], candidateGaps: [], contradictions: [], modelAssessmentConfidence: 0.9, recommendTransition: false }, { id, content }, now);
    let r = apply(state(), "first", "金融体系是分析对象，还需要观察体系提供服务的能力。");
    const different = "金融体系的支付与信贷功能应与个别机构的盈亏加以区分。";
    r = apply(r, "different", different);
    expect(r.flags).not.toContain("FLAG_COPY_SUSPECTED");
    expect(r.v12!.observations.filter((o) => o.ref.messageId === "different").every((o) => o.independent)).toBe(true);
    const copy = apply(r, "copy", `  ${different}  `);
    expect(copy.flags).toContain("FLAG_COPY_SUSPECTED");
    expect(copy.v12!.lastResult).toBe("NEED_VERIFY");
  });

  it("preserves actual case facts while choosing only a neutral presentation frame", () => {
    const r = state(); r.v12!.pedagogicalStage = "CASE_TRANSFER"; r.v12!.currentCaseId = m.cases[0].id;
    const prepared = prepareCoaching(m, r, { kind: "CASE", content: "暂定情境", learnerLevel: "进阶" });
    const decision = { choiceId: prepared.input.choices[1].id, openingId: "OPEN_DIRECT" };
    const presented = recordCoaching(r, prepared, decision, { requestId: "case", now }, m.cases[1].studentText);
    expect(presented.assistantMessage).toContain(m.cases[1].studentText);
    expect(presented.assistantMessage).not.toContain(m.cases[0].teacherData.excellentAnswer);
    expect(presented.assistantMessage).not.toContain("暂定情境");
  });

  it("keeps scores identical across presentation choices and names the missing rubric evidence", () => {
    const r = answer(state(), ["financial_system_scope", "functional_impairment"]);
    r.v12!.finalFeynmanMessageId = "answer";
    const messages = [{ id: "answer", role: "USER", content: "这是answer的独立解释，陈述概念、因果联系及适用条件。" }];
    const prepared = prepareCoaching(m, r, { kind: "REPORT", content: "学习反馈", learnerLevel: "入门" });
    const scores = prepared.input.choices.map((c) => {
      const next = recordCoaching(r, prepared, { choiceId: c.id, openingId: "OPEN_DIRECT" }, { requestId: c.id, now }).runtime;
      return buildV12Report(m, next, messages).report;
    });
    expect(scores[0].dimensions).toEqual(scores[1].dimensions);
    expect(scores[0].overallScore).toBe(scores[1].overallScore);
    expect(scores[0].dimensions.logicCompleteness.feedback).toContain(m.v12!.evidenceDefinitions.shock);
  });

  it("uses generated text as the actual next question and preserves its locked evidence rule", () => {
    const r = answer(state(), ["financial_system_scope", "functional_impairment"]);
    const prepared = prepareCoaching(m, r, { kind: "QUESTION", content: "原题", learnerLevel: "有基础", studentContent: "我认为关键是支付中断。", recentTurns: [{ role: "USER", content: "过往表述" }] });
    expect(prepared.input.grounding?.requirements.requiredAll).toEqual(["condition_revision"]);
    expect(prepared.input.recentTurns?.[0].content).toBe("过往表述");
    expect(prepared.input.grounding?.sources.some((s) => s.id === "C_SR_001")).toBe(true);
    const followUp = { question: "你提到“支付中断”，如果这项服务很快由其他机构接替，你的判断会如何改变？", studentAnchor: "支付中断", focusEvidenceIds: ["condition_revision"], sourceIds: ["C_SR_001"] };
    const next = recordCoaching(r, prepared, { choiceId: prepared.input.choices[0].id, openingId: "OPEN_FOCUS", followUp }, { requestId: "generated", now });
    expect(next.assistantMessage).toBe(followUp.question);
    expect(next.runtime.v12!.coachingPrompt?.text).toBe(followUp.question);
    expect(activeRule(m, next.runtime).requiredAll).toEqual(["condition_revision"]);
    expect(next.runtime.v12!.coachingHistory.at(-1)?.followUp).toEqual(followUp);
    expect(prepareCoaching(m, next.runtime, { kind: "QUESTION", content: "原题", learnerLevel: "有基础", studentContent: "需要补充解释。" }).input.previousQuestions).toContain(followUp.question);
  });

  it("does not rewrite case verification, switch-target questions or reporting tasks", () => {
    const r = answer(state(), ["financial_system_scope", "functional_impairment"]);
    for (const kind of ["CASE", "REPORT", "HINT", "FEYNMAN", "REFLECTION", "RESUME", "RETRY", "GOAL"] as const) {
      expect(prepareCoaching(m, r, { kind, content: "锁定任务", learnerLevel: "有基础", studentContent: "本轮学生表达" }).input.grounding).toBeUndefined();
    }
    const oldProfile = diagnoseCoaching(m, r, "有基础");
    const different = state("M_SR_004");
    expect(prepareCoaching(m, different, { kind: "QUESTION", content: "新目标问题", learnerLevel: "有基础", profile: oldProfile, studentContent: "本轮学生表达" }).input.grounding).toBeUndefined();
    r.v12!.currentCaseId = m.cases[0].id;
    r.currentQuestionId = "CASE_VERIFY_1";
    const prepared = prepareCoaching(m, r, { kind: "QUESTION", content: "案例事实原文", learnerLevel: "有基础", studentContent: "学生对案例的回答" });
    expect(prepared.input.grounding).toBeUndefined();
    expect(prepared.choices.every((c) => c.framed)).toBe(true);
  });

  it("does not overlook a condition gap merely because an older verification count exists", () => {
    const r = answer(state(), ["financial_system_scope", "functional_impairment"]);
    r.v12!.unitStates.C_SR_001.status = "PARTIAL";
    r.v12!.unitStates.C_SR_001.verificationCount = 2;
    const profile = diagnoseCoaching(m, r, "有基础");
    expect(profile.dimension).toBe("CONDITION");
    expect(profile.missingEvidenceIds).toContain("condition_revision");
  });

  it("follows a successful narrow condition check with an explicit integrated application when needed", () => {
    const r = answer(state(), ["financial_system_scope", "functional_impairment"]);
    const prepared = prepareCoaching(m, r, { kind: "QUESTION", content: "原题", learnerLevel: "有基础" });
    const focused = recordCoaching(r, prepared, { choiceId: prepared.input.choices[0].id, openingId: "OPEN_DIRECT" }, { requestId: "condition", now }).runtime;
    const checked = answer(focused, ["condition_revision"], 0.9, "condition-answer");
    expect(checked.v12!.unitStates.C_SR_001.status).toBe("PARTIAL");
    const next = prepareCoaching(m, checked, { kind: "QUESTION", content: "原题", learnerLevel: "有基础", studentContent: "如果服务能由别的机构承接，原结论需要调整。" });
    expect(next.input.profile.reasonId).toBe("COACH_VERIFY_INDEPENDENT");
    expect(next.input.grounding?.requirements.requiredAll).toEqual(["financial_system_scope", "condition_revision"]);
    expect(next.input.grounding?.requirements.requiredAny).toEqual(["functional_impairment", "broad_propagation"]);
  });
});
