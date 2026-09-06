import "server-only";

import type { LearningPhase } from "../contracts";
import { getRuntimeManifests } from "../knowledge/releases";
import type { KnowledgeManifest } from "../knowledge/schemas";
import type { RetrievedChunk, RetrievalProvider, RetrievalQuery } from "./types";

const targetAliases: Record<string, string[]> = {
  C_SR_001: ["定义", "概念", "单个机构", "金融体系", "功能受损"],
  C_SR_002: ["systemic", "systematic", "idiosyncratic", "不可分散", "市场风险", "个体风险"],
  M_SR_001: ["同业", "交易对手", "担保", "直接关联", "直接借贷", "债权债务"],
  M_SR_002: ["共同暴露", "共同持仓", "相同资产", "房地产", "没有借贷", "没有直接联系"],
  M_SR_003: ["fire sale", "抛售", "价格下跌", "价格螺旋", "去杠杆", "保证金"],
  M_SR_004: ["流动性", "挤兑", "提款", "融资收缩", "赎回"],
  M_SR_005: ["信心", "恐慌", "预期", "信息", "风险偏好"],
  M_SR_006: ["支付", "清算", "金融基础设施", "关键服务", "结算"],
  D_SR_001: ["横截面", "机构间", "风险分布", "系统重要性"],
  D_SR_002: ["时间维度", "金融周期", "顺周期", "风险积累"],
  C_SR_003: ["系统重要性", "规模", "关联性", "可替代性", "复杂性"],
  M_SR_007: ["实体经济", "信贷收缩", "企业", "投资", "就业", "反馈"],
  C_SR_004: ["微观审慎", "宏观审慎", "个体安全", "系统安全", "个体理性"],
};

function normalize(value: string): string {
  return value.toLowerCase();
}

function queryTerms(query: string): string[] {
  return [...new Set(query.match(/[\p{Script=Han}]{2,8}|[a-z][a-z0-9-]{2,}/giu) ?? [])].slice(0, 20).map(normalize);
}

function manifestMatches(manifest: KnowledgeManifest, query: string): boolean {
  const text = `${manifest.course.title} ${manifest.chapter.title} ${manifest.knowledgePoint.title} ${manifest.knowledgePoint.code}`.toLowerCase();
  const normalizedQuery = normalize(query);
  return normalizedQuery.includes(normalize(manifest.knowledgePoint.title)) || normalizedQuery.includes("systemic risk") || text.includes(normalizedQuery);
}

function textScore(text: string, terms: string[]): number {
  const normalized = normalize(text);
  return terms.reduce((sum, term) => sum + (normalized.includes(term) ? 2 : 0), 0);
}

function addResult(results: RetrievedChunk[], item: Omit<RetrievedChunk, "materialId"> & { materialId?: string }): void {
  results.push({ ...item, materialId: item.materialId ?? "structured-knowledge" });
}

export class StructuredKnowledgeRetriever implements RetrievalProvider {
  async retrieve(input: RetrievalQuery): Promise<RetrievedChunk[]> {
    const terms = queryTerms(`${input.query} ${input.targetConcept ?? ""} ${(input.errorTags ?? []).join(" ")}`);
    if (!terms.length && !input.errorTags?.length && !input.targetConcept) return [];

    const results: RetrievedChunk[] = [];
    for (const manifest of await getRuntimeManifests(Boolean(input.releaseId))) {
      if (input.releaseId && input.releaseId !== manifest.release.id) continue;
      if (!manifestMatches(manifest, input.query) && !manifest.knowledgeUnits.some((unit) => unit.id === input.targetConcept) && !manifest.misconceptions.some((item) => input.errorTags?.includes(item.id))) continue;
      const exactTarget = input.targetConcept ?? manifest.socraticQuestions.find((question) => question.triggerErrorTags.some((tag) => input.errorTags?.includes(tag)))?.targetUnitId;
      collectManifestResults(results, manifest, input.phase, exactTarget, input.errorTags ?? [], terms);
    }
    const filtered = results.filter((item) => item.visibility !== "TEACHER" && item.visibility !== "ADMIN"
      && (!input.usedQuestionIds?.includes(item.id) || input.selectedQuestionId === item.id)
      && (!input.usedCaseIds?.includes(item.id) || input.selectedCaseId === item.id)
      && (!input.selectedQuestionId || item.resourceType !== "SOCRATIC_QUESTION" || item.id === input.selectedQuestionId)
      && (!input.selectedCaseId || item.resourceType !== "CASE" || item.id === input.selectedCaseId));
    const selected = diversify(filtered.filter((item) => item.resourceType !== "HINT"), input.limit);
    const question = selected.find((item) => item.resourceType === "SOCRATIC_QUESTION");
    if (question && input.hintLevel) {
      const hint = filtered.find((item) => item.resourceType === "HINT" && item.content.includes(`level ${input.hintLevel} for ${question.id}:`));
      if (hint && selected.length < input.limit) selected.push(hint);
    }
    return selected;
  }
}


function diversify(results: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const sorted = [...results].sort((left, right) => right.score - left.score);
  const used = new Set<string>();
  const selected: RetrievedChunk[] = [];
  const requiredPass: Array<[NonNullable<RetrievedChunk["resourceType"]>, number]> = [
    ["MISCONCEPTION", 1],
    ["KNOWLEDGE_UNIT", 2],
    ["SOCRATIC_QUESTION", 1],
    ["DIAGNOSTIC_QUESTION", 1],
    ["CASE", 1],
    ["HINT", 1],
    ["RUBRIC", 1],
    ["MATERIAL_CHUNK", 1],
  ];
  const caps: Partial<Record<NonNullable<RetrievedChunk["resourceType"]>, number>> = {
    MISCONCEPTION: 2,
    KNOWLEDGE_UNIT: 3,
    SOCRATIC_QUESTION: 1,
    HINT: 1,
    CASE: 1,
    DIAGNOSTIC_QUESTION: 1,
    RUBRIC: 1,
    MATERIAL_CHUNK: 3,
  };
  const counts = new Map<NonNullable<RetrievedChunk["resourceType"]>, number>();

  const take = (item: RetrievedChunk): void => {
    const key = `${item.resourceType ?? "UNKNOWN"}:${item.id}`;
    if (used.has(key) || selected.length >= limit) return;
    selected.push(item);
    used.add(key);
    const type = item.resourceType ?? "MATERIAL_CHUNK";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  };

  for (const [type, count] of requiredPass) {
    for (const item of sorted.filter((candidate) => (candidate.resourceType ?? "MATERIAL_CHUNK") === type).slice(0, count)) {
      take(item);
    }
  }

  for (const item of sorted) {
    if (selected.length >= limit) break;
    const type = item.resourceType ?? "MATERIAL_CHUNK";
    if ((counts.get(type) ?? 0) >= (caps[type] ?? limit)) continue;
    take(item);
  }

  return selected;
}
function collectManifestResults(
  results: RetrievedChunk[],
  manifest: KnowledgeManifest,
  phase: LearningPhase | undefined,
  targetConcept: string | undefined,
  errorTags: string[],
  terms: string[],
): void {
  const targetUnits = new Set<string>();
  if (targetConcept) targetUnits.add(targetConcept);

  for (const misconception of manifest.misconceptions) {
    if (misconception.status !== "published") continue;
    const triggerHit = misconception.triggers.some((trigger) => terms.some((term) => normalize(trigger).includes(term) || term.includes(normalize(trigger))));
    const explicitHit = errorTags.includes(misconception.id) || errorTags.includes(misconception.category);
    if (explicitHit || triggerHit) {
      misconception.targetUnits.forEach((unitId) => targetUnits.add(unitId));
      addResult(results, {
        id: misconception.id,
        content: `Misconception ${misconception.id} (${misconception.category}): ${misconception.description} Recommended question type: ${misconception.recommendedQuestionType}. Target units: ${misconception.targetUnits.join(", ")}.`,
        score: explicitHit ? 120 : 85,
        resourceType: "MISCONCEPTION",
        visibility: "AI_INTERNAL",
      });
    }
  }

  for (const [unitId, aliases] of Object.entries(targetAliases)) {
    if (aliases.some((alias) => terms.some((term) => normalize(alias).includes(term) || term.includes(normalize(alias))))) targetUnits.add(unitId);
  }

  for (const unit of manifest.knowledgeUnits) {
    if (unit.status !== "published") continue;
    const targetHit = targetUnits.has(unit.id);
    const exactTargetBoost = unit.id === targetConcept ? 160 : 0;
    const score = exactTargetBoost + (targetHit ? 100 : 0) + textScore(`${unit.title} ${unit.summary} ${unit.content} ${unit.learningRequirement}`, terms);
    if (score <= 0) continue;
    const sources = unit.sourceRefs.map((sourceRef) => `${sourceRef.sourceId}@${sourceRef.sourceLocator}`).join("; ");
    addResult(results, {
      id: unit.id,
      content: `KnowledgeUnit ${unit.id} (${unit.type}, version ${unit.version}): ${unit.title}. ${unit.summary} Learning requirement: ${unit.learningRequirement}. Sources: ${sources}.`,
      score,
      resourceType: "KNOWLEDGE_UNIT",
      visibility: unit.visibility,
      knowledgeUnitId: unit.id,
    });
  }

  if (phase === "DIAGNOSIS") {
    for (const question of manifest.diagnosticQuestions) {
      if (question.status !== "published") continue;
      addResult(results, {
        id: question.id,
        content: `DiagnosticQuestion ${question.id}: ${question.questionText} Target concepts: ${question.targetConcepts.join(", ")}.`,
        score: 70 + textScore(question.questionText, terms),
        resourceType: "DIAGNOSTIC_QUESTION",
        visibility: "AI_INTERNAL",
      });
    }
  }

  if (phase === "SOCRATIC" || phase === undefined) {
    for (const question of manifest.socraticQuestions) {
      if (question.status !== "published") continue;
      const errorHit = question.triggerErrorTags.some((tag) => errorTags.includes(tag));
      const categoryHit = manifest.misconceptions.some((item) => question.triggerErrorCategories.includes(item.category) && (errorTags.includes(item.id) || errorTags.includes(item.category)));
      const targetHit = targetUnits.has(question.targetUnitId);
      const exactTargetBoost = question.targetUnitId === targetConcept ? 120 : 0;
      const score = exactTargetBoost + (errorHit || categoryHit ? 110 : 0) + (targetHit ? 90 : 0) + textScore(question.questionText, terms);
      if (score <= 0) continue;
      addResult(results, {
        id: question.id,
        content: `SocraticQuestion ${question.id} Group ${manifest.questionGroups.find((group) => group.memberIds.includes(question.id))?.id}: ${question.questionText} Type: ${question.questionType}. Target unit: ${question.targetUnitId}. Trigger errors: ${question.triggerErrorTags.join(", ")}.`,
        score,
        resourceType: "SOCRATIC_QUESTION",
        visibility: "AI_INTERNAL",
        knowledgeUnitId: question.targetUnitId,
      });
      for (const hint of manifest.hints.filter((item) => item.questionId === question.id)) {
        addResult(results, {
          id: hint.id,
          content: `Hint ${hint.id} level ${hint.level} for ${question.id}: ${hint.hintText}`,
          score: score - 5 + hint.level,
          resourceType: "HINT",
          visibility: "AI_INTERNAL",
          knowledgeUnitId: question.targetUnitId,
        });
      }
    }
  }

  if (phase === "SOCRATIC" || phase === "FEYNMAN" || phase === "REPORTING" || phase === undefined) {
    collectCases(results, manifest, targetUnits, terms, phase, targetConcept);
  }

  if (phase === "REPORTING" && manifest.rubric.status === "published") {
    addResult(results, {
      id: manifest.rubric.id,
      content: `Rubric ${manifest.rubric.id} version ${manifest.rubric.version}: ${manifest.rubric.dimensions.map((dimension) => `${dimension.code} max ${dimension.maxScore}: ${dimension.anchors.map((anchor) => `${anchor.scoreAnchor}=${anchor.description}`).join(" | ")}`).join("; ")}.`,
      score: 55,
      resourceType: "RUBRIC",
      visibility: "AI_INTERNAL",
    });
  }
}

function collectCases(
  results: RetrievedChunk[],
  manifest: KnowledgeManifest,
  targetUnits: Set<string>,
  terms: string[],
  phase: LearningPhase | undefined,
  targetConcept: string | undefined,
): void {
  for (const item of manifest.cases) {
    if (item.status !== "published") continue;
    const targetHit = item.targetUnits.some((unitId) => targetUnits.has(unitId));
    const lexicalScore = textScore(`${item.title} ${item.caseType} ${item.studentText} ${item.targetUnits.join(" ")}`, terms);
    const exactTargetBoost = targetConcept && item.targetUnits.includes(targetConcept) ? 140 : 0;
    const phaseBoost = phase === "SOCRATIC" && (item.caseType === "counterexample" || item.caseType === "transfer") ? 18 : 0;
    const score = exactTargetBoost + (targetHit ? 112 : 0) + lexicalScore + phaseBoost;
    if (score <= 0) continue;
    addResult(results, {
      id: item.id,
      content: `Case ${item.id} (${item.caseType}, difficulty ${item.difficulty}): ${item.title}. Student-visible case: ${item.studentText} Target units: ${item.targetUnits.join(", ")}.`,
      score,
      resourceType: "CASE",
      visibility: item.visibility,
    });
  }
}
