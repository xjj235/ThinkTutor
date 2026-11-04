import { describe, expect, it } from "vitest";
import type { LearningReportDTO, MessageDTO } from "@/lib/contracts";
import { reportDimensionSources } from "@/lib/report-evidence-view";

function message(id: string, role: MessageDTO["role"], content: string): MessageDTO {
  return { id, role, content, phase: "FEYNMAN", questionType: null, clientRequestId: null, webSources: [], knowledgePolicy: null, createdAt: "2026-11-04T00:00:00Z" };
}

function report(evidence: string, ids?: string[]): Pick<LearningReportDTO, "dimensions" | "evidenceLinks"> {
  const dimension = { score: 25, evidence, feedback: "需要更多独立作答。" };
  return {
    dimensions: { conceptCompleteness: dimension, logicCompleteness: dimension, expressionClarity: dimension, exampleAbility: dimension, transferAbility: dimension },
    evidenceLinks: ids ? { conceptCompleteness: [], logicCompleteness: [], expressionClarity: [], exampleAbility: [], transferAbility: ids } : undefined,
  };
}

describe("report citation coverage without inferring ability", () => {
  it("only displays actual student sources of the dimension citation, never coach or unresolved IDs", () => {
    const sources = reportDimensionSources(report("学生原文：“共同资产价格下降”。", ["student", "coach", "other", "missing"]), "transferAbility", [
      message("student", "USER", "共同资产价格下降会影响持有者。"),
      message("coach", "ASSISTANT", "共同资产价格下降之后呢？"),
      message("other", "USER", "不知道"),
    ]);
    expect(sources.map((source) => source.id)).toEqual(["student"]);
  });

  it("does not turn a low score or missing quotation into evidence of inability", () => {
    expect(reportDimensionSources(report("本次对话未充分展示独立迁移。", ["student"]), "transferAbility", [message("student", "USER", "我还没有尝试这个场景。")])).toEqual([]);
  });

  it("keeps a real citation visible even when the report says the evidence is insufficient", () => {
    const sources = reportDimensionSources(report("本次证据仍不足。学生原文：“还没有验证”。", ["student"]), "transferAbility", [message("student", "USER", "还没有验证这个判断。")]);
    expect(sources).toHaveLength(1);
    // A citation count is intentionally not a mastery or adequacy classification.
    expect(sources[0].content).toBe("还没有验证这个判断。");
  });

  it("can locate literal quotations in older reports without saved links, without inventing a source", () => {
    expect(reportDimensionSources(report("学生原文：“共同暴露”。"), "transferAbility", [message("student", "USER", "共同暴露")]).map((source) => source.id)).toEqual(["student"]);
    expect(reportDimensionSources(report("学生原文：“未说过的话”。"), "transferAbility", [message("student", "USER", "共同暴露")])).toEqual([]);
  });

  it("honors explicitly stored source selection and deduplicates repeated messages", () => {
    const student = message("student", "USER", "共同暴露");
    expect(reportDimensionSources(report("学生原文：“共同暴露”。", ["student"]), "transferAbility", [student, student, message("unselected", "USER", "共同暴露")])).toEqual([student]);
    expect(reportDimensionSources(report("学生原文：“共同暴露”。", []), "transferAbility", [student])).toEqual([]);
  });
});
