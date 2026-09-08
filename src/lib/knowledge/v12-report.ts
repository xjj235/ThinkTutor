import { dimensionKeys, type LearningReportDraft } from "../contracts";
import { computeOverallScore } from "../scoring";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { KnowledgeManifest } from "./schemas";
import { evaluateEvidenceRule, finalEvidenceIds } from "./v12-engine";
import type { ReportEvidenceLinks } from "./report-evidence";

export const v12Disclaimer = "本报告用于本次学习过程的形成性反馈，不等同于正式考试或标准化测评结果。";

export function buildV12Report(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, messages: Array<{ id: string; role: string; content: string }>) {
  const s = runtime.v12!;
  const windowIds = new Set(finalEvidenceIds(s));
  const windowMessages = messages.filter((m) => m.role === "USER" && windowIds.has(m.id));
  if (!windowMessages.length || windowMessages.length !== windowIds.size) throw new Error("Final evidence window references missing student messages");
  const observations = s.observations.filter((o) => windowIds.has(o.ref.messageId));
  for (const o of observations) {
    const message = windowMessages.find((m) => m.id === o.ref.messageId)!;
    if (message.content.slice(o.ref.startOffset, o.ref.endOffset) !== o.ref.extractedText) throw new Error("Report evidence no longer matches message");
  }
  const supported = new Set(observations.filter((o) => o.independent && o.confidence >= 0.75).map((o) => o.evidenceId));
  const groups: Record<typeof dimensionKeys[number], string[][]> = manifest.v12!.coachingPolicy?.scoreCriteria ?? {
    conceptCompleteness: [["financial_system_scope"], ["functional_impairment", "single_event_not_sufficient"], ["research_object_distinction", "systematic_market_factor"], ["condition_revision"]],
    logicCompleteness: [["shock"], ["propagation"], ["amplification"], ["system_consequence", "investment_employment_effect"]],
    expressionClarity: [["financial_system_scope", "shock"], ["propagation"], ["clear_expression"], ["condition_revision"]],
    exampleAbility: [["mechanism_example"], ["propagation"], ["amplification"], ["system_consequence"]],
    transferAbility: [["shock"], ["propagation"], ["amplification", "system_consequence"], ["condition_revision"]],
  };
  const evidenceLinks: ReportEvidenceLinks = { conceptCompleteness: [], logicCompleteness: [], expressionClarity: [], exampleAbility: [], transferAbility: [] };
  const dimensions = {} as LearningReportDraft["dimensions"];
  for (const key of dimensionKeys) {
    let steps = 0;
    for (const group of groups[key]) { if (!group.some((id) => supported.has(id))) break; steps += 1; }
    if (key === "transferAbility" && !s.transferPassed) steps = Math.min(steps, 2);
    const relevant = observations.filter((o) => groups[key].flat().includes(o.evidenceId));
    evidenceLinks[key] = [...new Set(relevant.map((o) => o.ref.messageId))];
    // A zero score cites the actual submitted answer as evidence of non-demonstration.
    if (!evidenceLinks[key].length) evidenceLinks[key] = [windowMessages.at(-1)!.id];
    const quoted = relevant[0]?.ref.extractedText ?? windowMessages.at(-1)!.content;
    const nextCriterion = groups[key].find((group) => !group.some((id) => supported.has(id)));
    const detail = key === "transferAbility" && !s.transferPassed ? "尚需完成未见情境中的独立迁移核验。" : nextCriterion ? `下一档需补充：${nextCriterion.map((id) => manifest.v12!.evidenceDefinitions[id]).join("，或")}。` : "最终回答覆盖本维度四级证据要求。";
    dimensions[key] = { score: steps * 25, evidence: `学生原文：“${quoted.slice(0, 450)}”`, feedback: `已覆盖 ${steps}/4 档证据要求。${detail}` };
  }
  for (const claim of Object.values(s.misconceptionStates)) {
    const definition = manifest.v12!.errors[claim.claimId];
    if (!definition) continue;
    // Re-evaluate lifecycle only from the final window, in message order.
    let status = claim.status;
    for (const m of windowMessages) {
      const current = observations.filter((o) => o.ref.messageId === m.id && o.independent && o.confidence >= 0.75).map((o) => o.evidenceId);
      if (current.includes(definition.evidenceId)) status = claim.verificationCount >= 2 ? "UNRESOLVED" : "CANDIDATE";
      else if (evaluateEvidenceRule(definition.resolutionRule, current) === "PASS") status = "RESOLVED";
    }
    claim.status = status;
    const finalNegative = observations.some((o) => o.evidenceId === definition.evidenceId && o.independent && o.confidence >= 0.75);
    if (!finalNegative || !["CONFIRMED", "UNRESOLVED"].includes(status)) continue;
    const cap = (key: typeof dimensionKeys[number], score: number) => {
      dimensions[key].score = Math.min(dimensions[key].score, score);
      dimensions[key].feedback = `最终证据仍包含已确认错误 ${claim.claimId}，本维度最高 ${score / 5}/20，需先修订该判断。`;
    };
    if (claim.claimId.startsWith("ERR_E01_")) cap("conceptCompleteness", 25);
    if (claim.claimId.startsWith("ERR_E02_")) { cap("conceptCompleteness", 50); cap("transferAbility", 50); }
    if (claim.claimId.startsWith("ERR_E06_")) { cap("logicCompleteness", 75); cap("transferAbility", 75); }
  }
  for (const claim of Object.values(s.gapStates)) {
    const rule = manifest.v12!.unitRules[manifest.v12!.gaps[claim.claimId]];
    if (!rule) continue;
    for (const message of windowMessages) {
      const evidence = observations.filter((o) => o.ref.messageId === message.id && o.independent && o.confidence >= 0.75);
      if (evaluateEvidenceRule(rule, evidence.map((o) => o.evidenceId)) === "PASS") {
        claim.status = "RESOLVED";
        const relevant = evidence.filter((o) => [...rule.requiredAll, ...rule.requiredAny].includes(o.evidenceId));
        claim.evidenceRefs = [...claim.evidenceRefs, ...relevant.map((o) => o.ref)];
      }
    }
  }
  s.finalClaims = (["MISCONCEPTION", "GAP"] as const).flatMap((type) => Object.values(type === "MISCONCEPTION" ? s.misconceptionStates : s.gapStates).map((c) => ({ id: c.claimId, type, status: c.status === "CONFIRMED" ? "UNRESOLVED" as const : c.status, evidenceRefs: c.evidenceRefs, confidence: c.systemConfidence })));
  s.needsTeacherReview ||= s.finalClaims.some((c) => c.status === "CANDIDATE") || runtime.flags.includes("FLAG_NEED_VERIFY") || [...windowIds].some((id) => (s.assessments[id]?.modelAssessmentConfidence ?? 0) < 0.75 || Boolean(s.assessments[id]?.contradictions.length));
  const unresolvedErrors = Object.values(s.misconceptionStates).filter((c) => ["CONFIRMED", "UNRESOLVED"].includes(c.status)).sort((a, b) => Number(/ERR_E0[12]_/.test(b.claimId)) - Number(/ERR_E0[12]_/.test(a.claimId)));
  const priorities = [...unresolvedErrors, ...Object.values(s.gapStates).filter((c) => c.status !== "RESOLVED")];
  const gaps = priorities.slice(0, 3).map((c, i) => ({ title: manifest.knowledgeUnits.find((u) => u.id === (manifest.v12!.errors[c.claimId]?.targetId ?? manifest.v12!.gaps[c.claimId]))?.title ?? "案例因果链与条件验证", evidence: `学生原文：“${c.evidenceRefs.at(-1)?.extractedText.slice(0, 350) ?? "缺少可核验原文"}”（${c.claimId}）`, repairTask: "用新的情境解释原因与后果，并改变一个条件再次判断。", priority: 5 - i }));
  if (!gaps.length && s.experienceLimitReached) gaps.push({ title: "独立迁移证据不足", evidence: "本次练习达到轮数上限，尚未通过案例迁移。", repairTask: "完成一次新案例的独立分析。", priority: 5 });
  const report = {
    summary: s.experienceLimitReached ? "本次练习已结束，未完成的验证保留为后续学习目标。" : "已根据最终案例、自主讲解与修订形成学习反馈。",
    overallLevel: "五档形成性评价", dimensions, strengths: Object.entries(s.unitStates).filter(([, u]) => u.status === "MASTERED" && u.evidenceRefs.some((r) => windowIds.has(r.messageId))).slice(0, 5).map(([id, unit]) => ({ title: manifest.knowledgeUnits.find((u) => u.id === id)?.title ?? id, evidence: `学生原文：“${unit.evidenceRefs.find((r) => windowIds.has(r.messageId))!.extractedText.slice(0, 350)}”` })),
    gaps, nextSteps: gaps.map((g) => g.repairTask), disclaimer: v12Disclaimer, overallScore: computeOverallScore(dimensionKeys.map((key) => dimensions[key].score)),
  };
  return { report, evidenceLinks };
}
