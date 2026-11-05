import { describe, expect, it } from "vitest";
import { parseEvidenceQuotes } from "@/lib/evidence-quotes";

describe("whole report quotations", () => {
  it("retains nested Chinese quotations as one literal citation", () => {
    const original = "例句中“叫醒”和“伸着懒腰”是人的动作，却由风和叶子表现出来，因此这句用了拟人。";
    expect(parseEvidenceQuotes("学生原文：“" + original + "”")).toEqual({ quotes: [original], valid: true });
  });
  it("handles mixed quotation pairs and separate outer citations", () => {
    expect(parseEvidenceQuotes('学生说：「他说“关键词是"变化"”并给出解释。」另说“条件相同”。')).toEqual({
      quotes: ['他说“关键词是"变化"”并给出解释。', "条件相同"], valid: true,
    });
  });
  it.each(["学生说：“未闭合", "学生说：内容”", "学生说：“错配」", "学生说：“嵌套“缺结束”", '学生说：“未闭合"内部”', "学生说：“”", "学生说：“跨\n行”"])("rejects malformed quotation boundaries: %s", (text) => {
    expect(parseEvidenceQuotes(text)).toEqual({ quotes: [], valid: false });
  });
  it("retains the existing quotation-length bound", () => {
    expect(parseEvidenceQuotes("“" + "字".repeat(600) + "”").valid).toBe(true);
    expect(parseEvidenceQuotes("“" + "字".repeat(601) + "”").valid).toBe(false);
  });
});
