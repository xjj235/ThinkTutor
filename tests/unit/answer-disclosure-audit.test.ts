import { describe, expect, it } from "vitest";
import { buildDisclosureAuditInput, disclosureFieldIds, validateDisclosureAudit } from "@/lib/ai/answer-disclosure-audit";

const question = "两条直角边为3和4，斜边长是多少？";
const input = buildDisclosureAuditInput(question, { observation: "你已说出适用条件。", focus: "完成具体计算。", whyItMatters: "核对代入。", progress: null }, ["我知道适用于直角三角形。"]);
const openAudit = () => ({ pendingTaskQuote: "斜边长是多少？", taskKind: "COMPUTE_NEW_VALUE", prematureDirection: null, namedTargetAttribute: null, remainingWork: "计算斜边长", fields: disclosureFieldIds.map((id) => ({ id, status: "OPEN" as const, quote: null, reason: null })) });

describe("independent disclosure audit evidence contract", () => {
  it("accepts complete coverage while retaining the actual new task", () => {
    expect(validateDisclosureAudit(openAudit(), input).verdict).toBe("PASS");
  });
  it("rejects duplicate IDs even when the array length is correct", () => {
    const audit = openAudit(); audit.fields[4] = audit.fields[0];
    expect(() => validateDisclosureAudit(audit, input)).toThrow("every fixed field");
  });
  it("rejects invented targets and citations attributed to the wrong field", () => {
    expect(() => validateDisclosureAudit({ ...openAudit(), pendingTaskQuote: "面积是多少？" }, input)).toThrow("actual question");
    const fields = openAudit().fields.map((field) => field.id === "focus" ? { ...field, status: "DISCLOSED", quote: input.fields[1].text, reason: "已给结论" } : field);
    expect(() => validateDisclosureAudit({ ...openAudit(), fields }, input)).toThrow("declared field");
  });
  it("rejects citing the whole pending question as a statement of its answer", () => {
    const fields = openAudit().fields.map((field) => field.id === "question" ? { ...field, status: "DISCLOSED", quote: "斜边长是多少？", reason: "错误地把问题当答案" } : field);
    expect(() => validateDisclosureAudit({ ...openAudit(), fields }, input)).toThrow("not a disclosed answer");
  });
  it("fails closed on uncertainty and binds a real disclosure to its field", () => {
    const uncertain = openAudit().fields.map((field) => field.id === "focus" ? { ...field, status: "UNCERTAIN", reason: "不确定待答范围" } : field);
    expect(validateDisclosureAudit({ ...openAudit(), fields: uncertain }, input).verdict).toBe("UNCERTAIN");
    const leaked = buildDisclosureAuditInput(question, { observation: "斜边长是5。", focus: "完成具体计算。", whyItMatters: "核对代入。", progress: null }, []);
    const fields = openAudit().fields.map((field) => field.id === "observation" ? { ...field, status: "DISCLOSED", quote: "斜边长是5", reason: "提前给出本轮数值" } : field);
    expect(validateDisclosureAudit({ ...openAudit(), fields }, leaked).verdict).toBe("ANSWER_DISCLOSED");
  });
  it("rejects a located presupposition even if the model marks all fields open", () => {
    const directed = buildDisclosureAuditInput(question, { observation: "纠正这个斜边长度判断。", focus: "计算斜边。", whyItMatters: "核对判断。", progress: null }, []);
    expect(validateDisclosureAudit({ ...openAudit(), prematureDirection: { field: "observation", quote: "纠正这个斜边长度判断", reason: "明确预设这个判断需要改正" } }, directed).verdict).toBe("ANSWER_DISCLOSED");
  });
});
