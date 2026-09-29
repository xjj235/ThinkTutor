import { describe, expect, it } from "vitest";
import {
  coachConditionalCheckSchema,
  validateCoachConditionalReasoning,
  type CoachConditionalCheck,
  type CoachPrerequisiteEvidence,
} from "@/lib/ai/coach-feedback";

const conclusionQuestion = "三个角分别为50°、60°、70°的三角形中，两条较短边的平方和等于最长边的平方吗？";
const applicationQuestion = "三个角分别为50°、60°、70°的三角形，能否直接应用已给出的勾股定理，依据是什么？";
const forwardRule: CoachPrerequisiteEvidence = {
  fact: "若三角形是直角三角形，则两条直角边的平方和等于斜边的平方。",
  kind: "DOMAIN_RULE",
  source: "REFERENCE",
  quote: "在直角三角形中，两条直角边的平方和等于斜边的平方。",
};
const inverseRule: CoachPrerequisiteEvidence = {
  fact: "若两条较短边的平方和等于最长边的平方，则该三角形是直角三角形。",
  kind: "DOMAIN_RULE",
  source: "REFERENCE",
  quote: "如果三角形两条较短边的平方和等于最长边的平方，那么这个三角形是直角三角形。",
};

function check(overrides: Partial<CoachConditionalCheck> = {}): CoachConditionalCheck {
  return {
    questionTarget: "CONCLUSION_TRUTH",
    questionQuote: conclusionQuestion,
    ruleIndex: 0,
    inference: "NOT_P_TO_NOT_Q",
    additionalRuleIndices: [],
    ...overrides,
  };
}

describe("conditional-rule coaching reasoning", () => {
  it("does not turn the absence of a right angle into proof of an unequal square relation", () => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check(), [forwardRule]))
      .toBe("prerequisitesSupported");
  });

  it("allows checking whether the supplied rule applies without asserting that its conclusion is false", () => {
    expect(validateCoachConditionalReasoning(applicationQuestion, check({
      questionTarget: "RULE_APPLICABILITY",
      questionQuote: applicationQuestion,
      inference: "APPLICATION_ONLY",
    }), [forwardRule])).toBeNull();
  });

  it("rejects an applicability answer when the question asks whether the conclusion is true", () => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({ inference: "APPLICATION_ONLY" }), [forwardRule]))
      .toBe("questionAnswerable");
  });

  it("allows the contrapositive of the supplied forward rule", () => {
    const question = "某三角形两条较短边的平方和不等于最长边的平方，它可能是直角三角形吗？";
    expect(validateCoachConditionalReasoning(question, check({
      questionQuote: question,
      inference: "NOT_Q_TO_NOT_P",
    }), [forwardRule])).toBeNull();
  });

  it("allows applying the supplied rule in its forward direction", () => {
    const question = "直角三角形的两条直角边长为3和4，斜边长是多少？";
    expect(validateCoachConditionalReasoning(question, check({
      questionQuote: question,
      inference: "P_TO_Q",
    }), [forwardRule])).toBeNull();
  });

  it("rejects inferring a right angle from the square relation when only the forward rule is supported", () => {
    const question = "某三角形两条较短边的平方和等于最长边的平方，它是否为直角三角形？";
    expect(validateCoachConditionalReasoning(question, check({
      questionQuote: question,
      inference: "Q_TO_P",
    }), [forwardRule])).toBe("prerequisitesSupported");
  });

  it.each(["NOT_P_TO_NOT_Q", "Q_TO_P"] as const)("allows %s with a separately supported inverse rule", (inference) => {
    const question = inference === "Q_TO_P"
      ? "某三角形两条较短边的平方和等于最长边的平方，它是否为直角三角形？"
      : conclusionQuestion;
    expect(validateCoachConditionalReasoning(question, check({
      questionQuote: question,
      inference,
      additionalRuleIndices: [1],
    }), [forwardRule, inverseRule])).toBeNull();
  });

  it("allows distinct rule directions supported by the same complete biconditional quotation", () => {
    const quote = "三角形是直角三角形，当且仅当两条较短边的平方和等于最长边的平方。";
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({
      additionalRuleIndices: [1],
    }), [{ ...forwardRule, quote }, { ...inverseRule, quote }])).toBeNull();
  });

  it("rejects ambiguous wording instead of silently treating conclusion truth as applicability", () => {
    const question = "三个角分别为50°、60°、70°的三角形中，勾股定理是否成立，依据是什么？";
    expect(validateCoachConditionalReasoning(question, check({
      questionTarget: "AMBIGUOUS",
      questionQuote: question,
    }), [forwardRule])).toBe("questionAnswerable");
  });

  it("requires the checked question quote to occur in the actual question", () => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({
      questionQuote: "能否直接应用已给出的勾股定理",
    }), [forwardRule])).toBe("questionAnswerable");
  });

  it.each([1, 3])("rejects a rule index %s absent from the supplied evidence", (ruleIndex) => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({
      ruleIndex,
      inference: "P_TO_Q",
    }), [forwardRule])).toBe("prerequisitesSupported");
  });

  it.each([
    { label: "reading or arithmetic", evidence: { ...forwardRule, kind: "READING_ARITHMETIC" as const } },
    { label: "unsupported", evidence: { ...forwardRule, source: "UNSUPPORTED" as const, quote: null } },
    { label: "a domain rule disguised as arithmetic", evidence: { ...forwardRule, source: "BASIC_OPERATION" as const, quote: null } },
    { label: "missing quotation", evidence: { ...forwardRule, quote: null } },
    { label: "blank quotation", evidence: { ...forwardRule, quote: "  " } },
  ])("rejects a primary rule with $label evidence", ({ evidence }) => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({ inference: "P_TO_Q" }), [evidence]))
      .toBe("prerequisitesSupported");
  });

  it.each([
    { label: "the primary rule itself", indices: [0] },
    { label: "duplicate indices", indices: [1, 1] },
    { label: "an out-of-range index", indices: [2] },
    { label: "a valid index followed by an out-of-range index", indices: [1, 2] },
  ])("rejects additional evidence containing $label", ({ indices }) => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({
      additionalRuleIndices: indices,
    }), [forwardRule, inverseRule])).toBe("prerequisitesSupported");
  });

  it.each([
    { label: "the exact same rule", evidence: { ...forwardRule } },
    { label: "the same fact under another source", evidence: { ...forwardRule, source: "QUESTION" as const } },
    { label: "the same fact with another quotation", evidence: { ...forwardRule, quote: inverseRule.quote } },
  ])("does not accept $label as an additional independent rule", ({ evidence }) => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({
      additionalRuleIndices: [1],
    }), [forwardRule, evidence])).toBe("prerequisitesSupported");
  });

  it.each([
    { label: "reading or arithmetic", evidence: { ...inverseRule, kind: "READING_ARITHMETIC" as const } },
    { label: "unsupported", evidence: { ...inverseRule, source: "UNSUPPORTED" as const, quote: null } },
    { label: "a domain rule disguised as arithmetic", evidence: { ...inverseRule, source: "BASIC_OPERATION" as const, quote: null } },
    { label: "missing quotation", evidence: { ...inverseRule, quote: null } },
    { label: "blank quotation", evidence: { ...inverseRule, quote: " " } },
  ])("rejects an additional rule with $label evidence", ({ evidence }) => {
    expect(validateCoachConditionalReasoning(conclusionQuestion, check({
      additionalRuleIndices: [1],
    }), [forwardRule, evidence])).toBe("prerequisitesSupported");
  });

  it.each(["一个90°的角通常叫什么角？", "直角所对的边通常叫什么？"])("does not require a conditional rule for direct naming: %s", (question) => {
    expect(validateCoachConditionalReasoning(question, null, [])).toBeNull();
  });
});

describe("conditional-check input bounds", () => {
  it.each([-1, 4, 0.5])("rejects invalid rule index %s before reasoning validation", (ruleIndex) => {
    expect(coachConditionalCheckSchema.safeParse(check({ ruleIndex })).success).toBe(false);
  });

  it("rejects more than three additional rule indices", () => {
    expect(coachConditionalCheckSchema.safeParse(check({ additionalRuleIndices: [0, 1, 2, 3] })).success).toBe(false);
  });

  it("rejects an empty question quote", () => {
    expect(coachConditionalCheckSchema.safeParse(check({ questionQuote: " " })).success).toBe(false);
  });

  it("accepts the complete bounded check shape", () => {
    const value = check({ additionalRuleIndices: [1] });
    expect(coachConditionalCheckSchema.parse(value)).toEqual(value);
  });
});
