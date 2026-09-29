import { describe, expect, it } from "vitest";
import { assertTeachingReview } from "@/lib/ai/teaching-review";
import { teachingReviewSchema, type TeachingSelection } from "@/lib/ai/teaching-schema";

const question = "你提到“只有直接联系才传播”，如果两家机构没有直接借贷但持有同类资产，同一价格冲击会通过什么过程让它们同时受损？";
const input: TeachingSelection = {
  kind: "QUESTION", profile: { targetId: "M_SR_002", level: "L2", dimension: "CONCEPT", reasonId: "COACH_REPAIR_BOUNDARY", observedEvidenceIds: ["direct_link_only"], missingEvidenceIds: ["no_direct_link_required"], basisMessageId: "answer", verifiedLevel: false },
  standard: "判断直接联系是否必要。", choices: [{ id: "FORM_CONCEPT_02", purpose: "边界辨析", template: "是否一定需要直接联系？" }],
  openings: [{ id: "OPEN_DIRECT", text: "" }], studentContent: "只有直接联系才传播",
  grounding: { targetId: "M_SR_002", targetTitle: "共同暴露", requirements: { requiredAll: ["no_direct_link_required"], requiredAny: [], prohibited: [] }, sources: [{ id: "M_SR_002", text: "没有直接借贷也可能因共同持仓而同时受损。" }], instructions: [], maxQuestionChars: 360 },
};
const candidate = { question, studentAnchor: "只有直接联系才传播", sourceIds: ["M_SR_002"] };
const review = teachingReviewSchema.parse({
  minimumAnswer: "共同持仓使得同一价格下降同时降低两家机构的资产价值。",
  requirementChecks: [{ evidenceId: "no_direct_link_required", status: "PROVIDED", questionQuote: "没有直接借贷但持有同类资产，同一价格冲击会通过什么过程让它们同时受损", rationale: "题干已经预设无直接联系时的共同损失，实际只问机制。" }],
  answerLeakQuote: "没有直接借贷但持有同类资产，同一价格冲击会通过什么过程让它们同时受损", missingInformation: null,
  grounded: true, targetAligned: true, answerConnected: true, nonRedundant: true, noAnswerLeak: true, questionAnswerable: true,
});

describe("curated teaching review uses actual elicited evidence", () => {
  it("rejects the saved live counterexample although its background is valid knowledge", () => {
    expect(() => assertTeachingReview(input, candidate, review)).toThrow();
    // Either concrete signal must reject even if the other was wrongly cleared.
    expect(() => assertTeachingReview(input, candidate, { ...review, answerLeakQuote: null })).toThrow();
    expect(() => assertTeachingReview(input, candidate, { ...review, requirementChecks: [{ ...review.requirementChecks[0], status: "ELICITED" }] })).toThrow();
  });

  it("accepts an open boundary judgment whose conclusion remains for the learner", () => {
    const openQuestion = "你提到“只有直接联系才传播”，如果没有直接借贷但存在共同持仓，风险是否仍可能影响两家机构？";
    const checked = { ...review, minimumAnswer: "有可能，需要说明共同持仓的影响途径。", answerLeakQuote: null,
      requirementChecks: [{ evidenceId: "no_direct_link_required", status: "ELICITED" as const, questionQuote: "风险是否仍可能影响两家机构？", rationale: "学生必须判断可能性，题干未给出结论。" }] };
    expect(() => assertTeachingReview(input, { ...candidate, question: openQuestion }, checked)).not.toThrow();
  });

  it("allows known initial consequences as background when the target is a later mechanism", () => {
    const mechanism = { ...input, grounding: { ...input.grounding!, requirements: { requiredAll: ["price_decline"], requiredAny: [], prohibited: [] } } };
    const mechanismQuestion = "你提到“共同持仓同时受损”，没有直接借贷的两家机构已经因共同持仓受到损失，随后集中出售这些资产，出售行为会怎样影响市场价格？";
    const checked = { ...review, minimumAnswer: "集中卖出增加资产供给并压低市场价格。", answerLeakQuote: null,
      requirementChecks: [{ evidenceId: "price_decline", status: "ELICITED" as const, questionQuote: "出售行为会怎样影响市场价格？", rationale: "共同受损只作给定背景，待问的出售与价格机制没有被给出。" }] };
    expect(() => assertTeachingReview(mechanism, { ...candidate, question: mechanismQuestion }, checked)).not.toThrow();
  });

  it("rejects missing case facts, invented quotes and incomplete or wrong requirement coverage", () => {
    const base = { ...review, answerLeakQuote: null, requirementChecks: [{ ...review.requirementChecks[0], status: "ELICITED" as const }] };
    for (const change of [
      { missingInformation: "需要未提供的银行资产负债规模才能比较损失金额。" },
      { requirementChecks: [{ ...base.requirementChecks[0], questionQuote: "候选问题没有这句原文" }] },
      { requirementChecks: [{ ...base.requirementChecks[0], evidenceId: "price_decline" }] },
      { requirementChecks: [...base.requirementChecks, ...base.requirementChecks] },
      { requirementChecks: [] },
    ]) expect(() => assertTeachingReview(input, candidate, { ...base, ...change })).toThrow();
  });

  it("requires every mandatory item but only one requested alternative to be elicited", () => {
    const alternatives = { ...input, grounding: { ...input.grounding!, requirements: { requiredAll: ["no_direct_link_required"], requiredAny: ["shared_asset_exposure", "confidence_channel"], prohibited: [] } } };
    const check = { ...review.requirementChecks[0], status: "ELICITED" as const };
    const valid = { ...review, answerLeakQuote: null, requirementChecks: [check, { ...check, evidenceId: "shared_asset_exposure" }, { ...check, evidenceId: "confidence_channel", status: "NOT_ASKED" as const, questionQuote: null }] };
    expect(() => assertTeachingReview(alternatives, candidate, valid)).not.toThrow();
    expect(() => assertTeachingReview(alternatives, candidate, { ...valid, requirementChecks: valid.requirementChecks.map((item) => item.evidenceId === "shared_asset_exposure" ? { ...item, status: "PROVIDED" } : item) })).toThrow();
  });
});
