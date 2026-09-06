import type { LearnerState, QuestionType } from "../contracts";
import type { KnowledgeManifest } from "./schemas";
import type { KnowledgeRuntime, SessionVersions } from "./runtime-schemas";
import { initialV12State } from "./v12-engine";

const gapAliases: Record<string, string> = {
  GAP_COMMON_EXPOSURE: "M_SR_002", GAP_FIRE_SALE_FEEDBACK: "M_SR_003",
  GAP_CAUSAL_CHAIN: "M_SR_001", GAP_TRANSFER: "M_SR_007", GAP_SYSTEM_FUNCTION: "C_SR_001",
};

export function normalizeSignals(manifest: KnowledgeManifest, state: LearnerState | null) {
  const candidates = (state?.misconceptions ?? []).flatMap((tag) => manifest.misconceptions.filter((item) => item.id === tag || item.category === tag).map((item) => item.id));
  const flag = "ERR_EXPRESSION_AMBIGUITY";
  const gaps = new Set((state?.gaps ?? []).filter((id) => manifest.knowledgeUnits.some((unit) => unit.id === id) || id in gapAliases));
  if (candidates.includes("ERR_E04_COMMON_EXPOSURE_FIRE_SALE_MISSING")) {
    gaps.add("GAP_COMMON_EXPOSURE"); gaps.add("GAP_FIRE_SALE_FEEDBACK");
  }
  if (candidates.includes("ERR_E07_DEFINITION_ONLY")) gaps.add("GAP_TRANSFER");
  return {
    candidateErrorIds: [...new Set(candidates.filter((id) => ![flag, "ERR_E04_COMMON_EXPOSURE_FIRE_SALE_MISSING", "ERR_E07_DEFINITION_ONLY"].includes(id)))],
    candidateGapIds: [...gaps],
    flags: candidates.includes(flag) ? ["FLAG_EXPRESSION_AMBIGUITY", "FLAG_NEED_VERIFY"] : [],
  };
}

export function initialKnowledgeRuntime(versions: SessionVersions): KnowledgeRuntime {
  return {
    schemaVersion: "2", pedagogicalStage: "DIAGNOSIS", currentTargetId: null, currentQuestionId: null,
    usedQuestionIds: [], usedCaseIds: [], targetAttempts: {}, hintLevels: {}, caseExposureCounts: {},
    candidateErrorIds: [], candidateGapIds: [], flags: [], versions,
    ...(versions.schemaVersion === "1.2" ? { v12: initialV12State() } : {}),
  };
}

export interface KnowledgeAction {
  questionId: string;
  groupId: string;
  targetId: string;
  caseId: string | null;
  assistantMessage: string;
  questionType: QuestionType;
  hintLevel: 0 | 1 | 2;
}

export function recordKnowledgeAnswer(state: KnowledgeRuntime): KnowledgeRuntime {
  const next = structuredClone(state);
  if (next.currentTargetId) next.targetAttempts[next.currentTargetId] = (next.targetAttempts[next.currentTargetId] ?? 0) + 1;
  return next;
}

export function selectKnowledgeAction(manifest: KnowledgeManifest, state: KnowledgeRuntime, learner: LearnerState | null, turn: number, hint = false): KnowledgeAction | null {
  if (hint) {
    const question = manifest.socraticQuestions.find((item) => item.id === state.currentQuestionId);
    if (!question) {
      const diagnostic = manifest.diagnosticQuestions.find((item) => item.id === state.currentQuestionId);
      if (!diagnostic || !state.currentTargetId) return null;
      const current = state.hintLevels[state.currentTargetId] ?? 0;
      if (current === 2) return null;
      const level = (current + 1) as 1 | 2;
      return { questionId: diagnostic.id, groupId: diagnostic.equivalentGroup, targetId: state.currentTargetId, caseId: null, assistantMessage: level === 1 ? "先从题目中的核心概念入手，你能用自己的话描述它吗？" : "试着区分一个具体事件和它影响整个体系的条件，你认为关键区别是什么？", questionType: "SCAFFOLDED_HINT", hintLevel: level };
    }
    const current = state.hintLevels[question.targetUnitId] ?? 0;
    if (current === 2) return null;
    const level = (current + 1) as 1 | 2;
    const item = manifest.hints.find((item) => item.questionId === question.id && item.level === level);
    if (!item) return null;
    return { questionId: question.id, groupId: manifest.questionGroups.find((group) => group.memberIds.includes(question.id))!.id, targetId: question.targetUnitId, caseId: null, assistantMessage: item.hintText, questionType: "SCAFFOLDED_HINT", hintLevel: level };
  }
  const signals = normalizeSignals(manifest, learner);
  const target = signals.candidateGapIds.map((id) => gapAliases[id] ?? id).find((id) => manifest.questionGroups.some((group) => group.targetId === id))
    ?? manifest.misconceptions.find((item) => signals.candidateErrorIds.includes(item.id))?.targetUnits.find((id) => manifest.questionGroups.some((group) => group.targetId === id));
  const groups = [...manifest.questionGroups].sort((a, b) => Number(b.targetId === target) - Number(a.targetId === target) || (state.targetAttempts[a.targetId] ?? 0) - (state.targetAttempts[b.targetId] ?? 0));
  const group = groups.find((group) => group.memberIds.some((id) => !state.usedQuestionIds.includes(id)));
  if (!group) return null;
  const question = manifest.socraticQuestions.find((item) => group.memberIds.includes(item.id) && !state.usedQuestionIds.includes(item.id) && item.status === "published");
  if (!question) return null;
  const usedVariants = new Set(manifest.cases.filter((item) => state.usedCaseIds.includes(item.id)).map((item) => item.variantGroupId));
  const selectedCase = turn >= 3 ? manifest.cases
    .filter((item) => item.status === "published" && item.visibility === "STUDENT" && item.targetUnits.includes(group.targetId) && !state.usedCaseIds.includes(item.id) && !usedVariants.has(item.variantGroupId))
    .sort((a, b) => (state.caseExposureCounts[a.id] ?? 0) - (state.caseExposureCounts[b.id] ?? 0) || Math.abs(a.difficulty - question.difficulty) - Math.abs(b.difficulty - question.difficulty))[0] : undefined;
  return {
    questionId: question.id, groupId: group.id, targetId: group.targetId, caseId: selectedCase?.id ?? null,
    assistantMessage: selectedCase ? `${selectedCase.studentText}\n\n你能围绕“${manifest.knowledgeUnits.find((unit) => unit.id === group.targetId)!.title}”解释这段情境中的风险机制吗？` : question.questionText,
    questionType: selectedCase ? "TRANSFER" : question.questionType, hintLevel: 0,
  };
}

export function recordKnowledgeAction(state: KnowledgeRuntime, action: KnowledgeAction, manifest: KnowledgeManifest, learner: LearnerState | null): KnowledgeRuntime {
  const next = structuredClone(state);
  next.currentQuestionId = action.questionId;
  next.currentTargetId = action.targetId;
  if (action.hintLevel > 0) {
    next.hintLevels[action.targetId] = action.hintLevel;
    if (action.hintLevel === 2) next.flags = [...new Set([...next.flags, "FLAG_NEED_VERIFY"])];
    return next;
  }
  next.pedagogicalStage = action.caseId ? "CASE_TRANSFER" : "SOCRATIC";
  if (!next.usedQuestionIds.includes(action.questionId)) next.usedQuestionIds.push(action.questionId);
  if (action.caseId) {
    next.usedCaseIds.push(action.caseId);
    next.caseExposureCounts[action.caseId] = (next.caseExposureCounts[action.caseId] ?? 0) + 1;
  }
  const signals = normalizeSignals(manifest, learner);
  return { ...next, ...signals, flags: [...new Set([...next.flags, ...signals.flags])] };
}
