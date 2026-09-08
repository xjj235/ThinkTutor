import type { KnowledgeManifest } from "./schemas";
import type { KnowledgeRuntime } from "./runtime-schemas";
import { activeRule } from "./v12-engine";

function quote(text: string): string {
  const excerpt = text.trim().slice(0, 100).replace(/\s+/gu, " ");
  const escaped = excerpt.replace(/[\\`*_[\]<>]/gu, "\\$&");
  return `「${escaped}${text.trim().length > 100 ? "…" : ""}」`;
}

export function buildV12TurnFeedback(manifest: KnowledgeManifest, answered: KnowledgeRuntime, assessed: KnowledgeRuntime, messageId: string): string {
  const state = assessed.v12;
  const assessment = state?.assessments[messageId];
  if (!state || !assessment || !manifest.v12) return "";
  const rule = activeRule(manifest, answered);
  const relevantIds = [...rule.requiredAll, ...rule.requiredAny, ...rule.prohibited];
  // Only server-validated references from this answer may appear in feedback.
  const observations = state.observations.filter((item) => item.ref.messageId === messageId && relevantIds.includes(item.evidenceId));
  const ids = new Set(observations.map((item) => item.evidenceId));
  const definition = (id: string) => manifest.v12!.evidenceDefinitions[id];
  const lines: string[] = [];
  const negative = observations.find((item) => rule.prohibited.includes(item.evidenceId));
  const positive = observations.filter((item) => !rule.prohibited.includes(item.evidenceId));

  if (state.lastResult === "NEED_VERIFY") {
    lines.push(assessment.contradictions.length
      ? "本轮回答存在需要澄清的冲突，暂不确认掌握。"
      : "本轮证据仍需核验，暂不确认掌握，也不将表述不足直接判为概念错误。");
    if (positive[0]) lines.push(`待核验的表述：${quote(positive[0].ref.extractedText)}`);
  } else {
    if (positive.length) {
      const covered = [...new Set(positive.map((item) => item.evidenceId))].slice(0, 2).map(definition);
      lines.push(`本轮相关依据：${covered.join("；")}。`, `原文依据：${quote(positive[0].ref.extractedText)}`);
    }
    if (negative) lines.push(`需要检验的判断：${quote(negative.ref.extractedText)}`, "这一判断的适用边界仍需核实。");
    if (state.lastResult === "PASS") lines.push("本轮证据已覆盖当前问题的要求；稳定掌握仍以多次独立核验为准。");
  }

  const missing = rule.requiredAll.filter((id) => !ids.has(id));
  if (missing.length) {
    lines.push(`下一步需要补充的依据：${missing.slice(0, 2).map(definition).join("；")}。`);
  } else if (rule.requiredAny.length && !rule.requiredAny.some((id) => ids.has(id))) {
    lines.push(`下一步至少澄清一项：${rule.requiredAny.slice(0, 2).map(definition).join("，或")}。`);
  } else if (state.lastResult === "PARTIAL") {
    lines.push("当前情境中的因果联系尚需补充，下一问将聚焦其中一处。");
  }
  return lines.join("\n\n");
}
