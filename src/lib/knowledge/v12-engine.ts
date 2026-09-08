import type { KnowledgeRuntime } from "./runtime-schemas";
import { createHash } from "node:crypto";
import type { KnowledgeManifest } from "./schemas";
import { type EvidenceRule, type TurnAssessment, type V12State, type EvidenceRef, turnAssessmentSchema, v12StateSchema } from "./v12-schema";
import type { KnowledgeAction } from "./orchestrator";
import { applicablePedagogyRules } from "./pedagogy";

export function initialV12State(): V12State {
  return v12StateSchema.parse({ schemaVersion: "1.2", pedagogicalStage: "DIAGNOSIS", activityType: "DIAGNOSTIC_QUESTION", diagnosticLevel: null, diagnosticMessageIds: [], currentGroupId: null, currentCaseId: null, currentCaseUnseen: false, unitStates: {}, misconceptionStates: {}, gapStates: {}, observations: [], assessments: {}, noProgressCounts: {}, usedGroupIds: [], caseLastUsedAt: {}, ownCaseExposureCounts: {}, lastResult: null, transferPassed: false, finalTransferMessageId: null, finalFeynmanMessageId: null, finalRevisionMessageId: null, reflectionTargetId: null, needsTeacherReview: false, experienceLimitReached: false, migrationLog: [] });
}

export function evaluateEvidenceRule(rule: EvidenceRule, evidenceIds: Iterable<string>): "PASS" | "PARTIAL" | "FAIL" {
  const ids = new Set(evidenceIds);
  if (rule.prohibited.some((id) => ids.has(id))) return "FAIL";
  if (rule.requiredAll.every((id) => ids.has(id)) && (!rule.requiredAny.length || rule.requiredAny.some((id) => ids.has(id)))) return "PASS";
  return [...rule.requiredAll, ...rule.requiredAny].some((id) => ids.has(id)) ? "PARTIAL" : "FAIL";
}

export function constructionReady(state: V12State): boolean {
  const mastered = (id: string) => state.unitStates[id]?.status === "MASTERED";
  const mechanisms = ["M_SR_001", "M_SR_002", "M_SR_003", "M_SR_004", "M_SR_005", "M_SR_006"].filter(mastered);
  const major = Object.values(state.misconceptionStates).some((c) => ["CONFIRMED", "UNRESOLVED"].includes(c.status) && /ERR_E0[12]_/.test(c.claimId));
  return mastered("C_SR_001") && mastered("C_SR_002") && !major && mechanisms.length >= 2 && mechanisms.some((id) => id !== "M_SR_001");
}

export function aggregateDiagnosticLevel(state: V12State): "L1" | "L2" | "L3" | "L4" {
  if (!state.unitStates.C_SR_001 || ["UNKNOWN", "GAP"].includes(state.unitStates.C_SR_001.status) || Object.values(state.misconceptionStates).some((c) => /ERR_E0[12]_/.test(c.claimId) && ["CONFIRMED", "UNRESOLVED"].includes(c.status))) return "L1";
  const verified = Object.entries(state.unitStates).filter(([id, u]) => /^M_SR_00[1-6]$/.test(id) && u.verificationCount > 0 && u.status === "MASTERED").map(([id]) => id);
  if (verified.length < 2 || !verified.some((id) => id !== "M_SR_001")) return "L2";
  if (state.transferPassed && state.observations.some((o) => o.independent && ["functional_impairment", "investment_employment_effect"].includes(o.evidenceId))) return "L4";
  return "L3";
}

export function diagnosticFinished(runtime: KnowledgeRuntime): boolean {
  const s = runtime.v12!;
  if (s.diagnosticMessageIds.length < 2 || s.lastResult === "NEED_VERIFY" || !s.lastResult) return false;
  const latest = s.assessments[s.diagnosticMessageIds.at(-1)!];
  if (!latest || latest.contradictions.length || latest.modelAssessmentConfidence < 0.75) return false;
  const stableClaim = [...Object.values(s.misconceptionStates), ...Object.values(s.gapStates)].some((c) => c.status === "CONFIRMED" && c.systemConfidence >= 0.75 && c.verificationCount >= 2 && c.evidenceConsistency === 1);
  const stableMastery = Object.values(s.unitStates).some((u) => u.status === "MASTERED" && u.independentEvidenceCount >= 2 && u.verificationCount > 0);
  if (!stableClaim && !stableMastery) return false;
  if (runtime.flags.includes("FLAG_NEED_VERIFY")) return false;
  if (aggregateDiagnosticLevel(s) === "L1" && s.diagnosticMessageIds.length >= 3) return true;
  const groups = new Set(runtime.usedQuestionIds.filter((id) => id.startsWith("DQ_")).map((id) => id.slice(0, -2)));
  return groups.size >= 5 || s.diagnosticMessageIds.length >= 15;
}

export function criticalStepRule(manifest: KnowledgeManifest, step: string): EvidenceRule {
  const rule = manifest.v12!.unitRules[step] ?? manifest.v12!.relationRules[step];
  if (!rule) throw new Error(`Missing executable critical step: ${step}`);
  return rule;
}

export function baseV12Rule(manifest: KnowledgeManifest, runtime: KnowledgeRuntime): EvidenceRule {
  const s = runtime.v12!;
  const config = manifest.v12!;
  if (s.resumeVerification) return config.unitRules[runtime.currentTargetId!];
  if (s.pedagogicalStage === "CASE_TRANSFER" && s.currentCaseId) return config.cases[s.currentCaseId].rule;
  if (s.pedagogicalStage === "FEYNMAN_OUTPUT") return { requiredAll: ["financial_system_scope", "propagation", "mechanism_example"], requiredAny: [], prohibited: Object.values(config.errors).map((e) => e.evidenceId) };
  if (s.pedagogicalStage === "REFLECTION") return config.unitRules[s.reflectionTargetId ?? ""] ?? { requiredAll: ["clear_expression"], requiredAny: [], prohibited: [] };
  const diagnostic = manifest.diagnosticQuestions.find((q) => q.id === runtime.currentQuestionId);
  return diagnostic ? config.diagnosticRules[diagnostic.equivalentGroup] : config.groups[s.currentGroupId!]?.rule ?? config.unitRules[runtime.currentTargetId!];
}

export function activeRule(manifest: KnowledgeManifest, runtime: KnowledgeRuntime): EvidenceRule {
  const s = runtime.v12!;
  if (["DIAGNOSIS", "KNOWLEDGE_CONSTRUCTION"].includes(s.pedagogicalStage) && !s.resumeVerification && s.coachingPrompt?.questionId === runtime.currentQuestionId && s.coachingPrompt?.stage === s.pedagogicalStage) return s.coachingPrompt.rule;
  return baseV12Rule(manifest, runtime);
}

export function applyV12Assessment(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, raw: TurnAssessment, message: { id: string; content: string }, now: string): KnowledgeRuntime {
  const assessment = turnAssessmentSchema.parse(raw);
  const next = structuredClone(runtime);
  const s = next.v12!;
  const config = manifest.v12!;
  if (s.assessments[message.id]) throw new Error("Assessment message already applied");
  const refs = new Map<string, EvidenceRef>();
  for (const item of assessment.evidence) {
    const offset = message.content.indexOf(item.extractedText);
    if (item.messageId !== message.id || offset < 0 || !config.evidenceDefinitions[item.evidenceId]) throw new Error("Invalid or fabricated evidence reference");
    refs.set(item.evidenceId, { messageId: message.id, startOffset: offset, endOffset: offset + item.extractedText.length, extractedText: item.extractedText });
  }
  for (const c of assessment.candidateMastery) if (!config.unitRules[c.unitId]) throw new Error("Unknown mastery target");
  for (const c of assessment.candidateMisconceptions) if (!config.errors[c.id]) throw new Error("Unknown misconception");
  for (const c of assessment.candidateGaps) if (!config.gaps[c.id]) throw new Error("Unknown gap");
  if (assessment.contradictions.some((id) => !refs.has(id))) throw new Error("Contradiction lacks message evidence");
  const fingerprint = createHash("sha256").update(message.content.normalize("NFKC").replace(/\s+/gu, "")).digest("hex");
  const duplicateText = Object.values(s.answerFingerprints).includes(fingerprint);
  const independent = s.activityType !== "HINT" && !duplicateText && message.content.trim().length >= 12;
  const conflicting = assessment.contradictions.length > 0 || Object.values(config.errors).some((e) => refs.has(e.evidenceId) && e.resolutionRule.requiredAll.every((id) => refs.has(id)));
  const reliable = assessment.modelAssessmentConfidence >= 0.75 && independent && !conflicting;
  s.assessments[message.id] = assessment;
  s.lastAssessmentMessageId = message.id;
  s.answerFingerprints[message.id] = fingerprint;
  // Keep raw model confidence in assessments; contradictory evidence cannot support a score.
  for (const [evidenceId, ref] of refs) s.observations.push({ evidenceId, ref, independent, confidence: conflicting ? Math.min(0.49, assessment.modelAssessmentConfidence) : assessment.modelAssessmentConfidence });
  const result = evaluateEvidenceRule(activeRule(manifest, next), refs.keys());
  const scopedQuestion = JSON.stringify(activeRule(manifest, next)) !== JSON.stringify(baseV12Rule(manifest, next));
  s.lastResult = !reliable ? "NEED_VERIFY" : result;
  if (!reliable) next.flags = [...new Set([...next.flags, "FLAG_NEED_VERIFY", ...(duplicateText ? ["FLAG_COPY_SUSPECTED"] : []), ...(message.content.trim().length < 12 ? ["FLAG_LOW_EFFORT"] : [])])];
  else next.flags = next.flags.filter((id) => !["FLAG_NEED_VERIFY", "FLAG_LOW_EFFORT", "FLAG_COPY_SUSPECTED"].includes(id));
  s.needsTeacherReview ||= conflicting;
  for (const flag of ["FLAG_NEED_VERIFY", "FLAG_COPY_SUSPECTED", "FLAG_LOW_EFFORT"]) {
    if (next.flags.includes(flag)) s.flagStates[flag] = { claimId: flag, status: "CANDIDATE", modelAssessmentConfidence: assessment.modelAssessmentConfidence, evidenceConsistency: conflicting ? 0 : 1, verificationCount: 0, contradictionCount: Number(conflicting), systemConfidence: 0.4, evidenceRefs: [{ messageId: message.id, startOffset: 0, endOffset: message.content.length, extractedText: message.content }] };
    else if (s.flagStates[flag]) s.flagStates[flag].status = "RESOLVED";
  }
  const questionKey = s.currentCaseId ?? next.currentQuestionId ?? s.pedagogicalStage;
  for (const [id, r] of Object.entries(config.unitRules)) {
    const outcome = evaluateEvidenceRule(r, refs.keys());
    const old = s.unitStates[id];
    if (outcome !== "PASS" && id !== next.currentTargetId) continue;
    if (scopedQuestion && outcome !== "PASS" && !r.prohibited.some((id) => refs.has(id))) continue;
    const evidenceRefs = [...refs].filter(([e]) => [...r.requiredAll, ...r.requiredAny, ...r.prohibited].includes(e)).map(([, ref]) => ref);
    const newIndependent = reliable && outcome === "PASS" && !old?.questionIds.includes(questionKey);
    const count = (old?.independentEvidenceCount ?? 0) + Number(newIndependent);
    const conditionVerified = !["C_SR_001", "M_SR_003"].includes(id) || refs.has("condition_revision");
    const verificationCount = (old?.verificationCount ?? 0) + Number(newIndependent && count >= 2 && conditionVerified);
    s.unitStates[id] = { status: outcome === "PASS" ? (reliable && count >= 2 && conditionVerified ? "MASTERED" : old?.status === "MASTERED" ? "MASTERED" : "PARTIAL") : outcome === "PARTIAL" ? "PARTIAL" : "GAP", independentEvidenceCount: count, verificationCount, evidenceRefs: [...(old?.evidenceRefs ?? []), ...evidenceRefs], questionIds: newIndependent ? [...(old?.questionIds ?? []), questionKey] : old?.questionIds ?? [], lastUpdatedAt: now };
  }
  for (const [id, error] of Object.entries(config.errors)) {
    const old = s.misconceptionStates[id];
    const negative = refs.get(error.evidenceId);
    const positive = evaluateEvidenceRule(error.resolutionRule, refs.keys()) === "PASS";
    if (negative) {
      const model = assessment.candidateMisconceptions.find((c) => c.id === id)?.modelConfidence ?? assessment.modelAssessmentConfidence;
      const verificationCount = (old?.verificationCount ?? 0) + Number(independent);
      const contradictionCount = (old?.contradictionCount ?? 0) + Number(conflicting);
      s.misconceptionStates[id] = { claimId: id, status: old && ["CONFIRMED", "UNRESOLVED"].includes(old.status) ? old.status : reliable && model >= 0.75 && verificationCount >= 2 ? "CONFIRMED" : "CANDIDATE", modelAssessmentConfidence: model, verificationCount, contradictionCount, evidenceConsistency: conflicting ? 0 : 1, systemConfidence: reliable ? Math.min(model, verificationCount >= 2 ? 1 : 0.7) : Math.min(model, 0.49), evidenceRefs: [...(old?.evidenceRefs ?? []), negative] };
      if (s.unitStates[error.targetId]) s.unitStates[error.targetId].status = "GAP";
    } else if (old && positive && reliable) {
      old.status = "RESOLVED";
      old.evidenceRefs.push(...[...refs].filter(([e]) => [...error.resolutionRule.requiredAll, ...error.resolutionRule.requiredAny].includes(e)).map(([, ref]) => ref));
      old.verificationCount += 1;
    }
  }
  for (const relation of config.relations.filter((r) => r.scope === "mastery_dependency")) {
    if (s.unitStates[relation.source]?.status === "MASTERED" && s.unitStates[relation.target]?.status !== "MASTERED") s.unitStates[relation.source].status = "PARTIAL";
  }
  const target = next.currentTargetId;
  if (target) {
    next.targetAttempts[target] = (next.targetAttempts[target] ?? 0) + 1;
    s.noProgressCounts[target] = s.lastResult === "PASS" ? 0 : (s.noProgressCounts[target] ?? 0) + 1;
    const gapIds = Object.keys(config.gaps).filter((id) => config.gaps[id] === target);
    for (const id of gapIds) {
      const old = s.gapStates[id];
      if (scopedQuestion && s.lastResult === "PASS" && evaluateEvidenceRule(config.unitRules[target], refs.keys()) !== "PASS") continue;
      s.gapStates[id] = { claimId: id, status: s.lastResult === "PASS" ? "RESOLVED" : reliable ? "CONFIRMED" : "CANDIDATE", modelAssessmentConfidence: assessment.modelAssessmentConfidence, verificationCount: (old?.verificationCount ?? 0) + Number(reliable), contradictionCount: Number(conflicting), evidenceConsistency: conflicting ? 0 : 1, systemConfidence: reliable ? 0.8 : 0.4, evidenceRefs: [...(old?.evidenceRefs ?? []), { messageId: message.id, startOffset: 0, endOffset: message.content.length, extractedText: message.content }] };
    }
  }
  if (s.pedagogicalStage === "DIAGNOSIS" && !s.resumeVerification) s.diagnosticMessageIds.push(message.id);
  if (s.pedagogicalStage === "CASE_TRANSFER" && s.currentCaseId && !s.resumeVerification) {
    const critical = config.cases[s.currentCaseId].criticalSteps;
    const stepPassed = (step: string) => evaluateEvidenceRule(criticalStepRule(manifest, step), refs.keys()) === "PASS";
    s.transferPassed = s.lastResult === "PASS" && s.currentCaseUnseen && critical.every(stepPassed);
    if (s.transferPassed) s.diagnosticLevel = aggregateDiagnosticLevel(s);
    s.finalTransferMessageId = message.id;
    if (!s.transferPassed) {
      s.lastResult = reliable ? "PARTIAL" : "NEED_VERIFY";
      const missing = critical.find((step) => !stepPassed(step));
      s.currentGroupId = missing ? config.cases[s.currentCaseId].followUp[missing] : "SQG_SR_010";
      const repairTarget = config.groups[s.currentGroupId]?.primaryTargetId;
      if (repairTarget && s.unitStates[repairTarget]) s.unitStates[repairTarget].status = "PARTIAL";
    }
  }
  if (s.pedagogicalStage === "FEYNMAN_OUTPUT" && !s.resumeVerification) s.finalFeynmanMessageId = message.id;
  if (s.pedagogicalStage === "REFLECTION" && !s.resumeVerification) s.finalRevisionMessageId = message.id;
  const policies = applicablePedagogyRules(config, s);
  s.appliedPedagogyRuleIds = policies.map((r) => r.id);
  if (policies.some((r) => r.effect.action === "VERIFY")) s.lastResult = "NEED_VERIFY";
  next.candidateErrorIds = Object.values(s.misconceptionStates).filter((c) => c.status !== "RESOLVED").map((c) => c.claimId);
  next.candidateGapIds = Object.values(s.gapStates).filter((c) => c.status !== "RESOLVED").map((c) => c.claimId);
  return next;
}

export function selectV12Action(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, now: string, hint = false): KnowledgeAction | null {
  const s = runtime.v12!;
  const config = manifest.v12!;
  if (hint) {
    const level = runtime.hintLevels[runtime.currentTargetId!] ?? 0;
    if (level >= 2 || !runtime.currentQuestionId || !runtime.currentTargetId) return null;
    const targetQuestion = manifest.socraticQuestions.find((q) => q.targetUnitId === runtime.currentTargetId && q.status === "published");
    const scaffold = manifest.hints.find((h) => h.questionId === runtime.currentQuestionId && h.level === level + 1)
      ?? manifest.hints.find((h) => h.questionId === targetQuestion?.id && h.level === level + 1);
    return { questionId: runtime.currentQuestionId, groupId: s.currentGroupId ?? "DIAGNOSIS", targetId: runtime.currentTargetId, caseId: s.currentCaseId, questionType: "SCAFFOLDED_HINT", hintLevel: (level + 1) as 1 | 2, assistantMessage: scaffold?.hintText ?? "先把条件、参与者的行为和后果分开，你能解释其中一处联系吗？" };
  }
  if (s.pedagogicalStage === "DIAGNOSIS") {
    const answeredGroups = new Set(runtime.usedQuestionIds.map((id) => manifest.diagnosticQuestions.find((q) => q.id === id)?.equivalentGroup));
    const current = manifest.diagnosticQuestions.find((q) => q.id === runtime.currentQuestionId);
    const candidates = manifest.diagnosticQuestions.filter((q) => !runtime.usedQuestionIds.includes(q.id));
    // Exhaustion cannot turn uncertain evidence into a successful diagnosis.
    const focusedRetry = s.lastResult === "NEED_VERIFY" || (["PARTIAL", "FAIL"].includes(s.lastResult ?? "") && (s.noProgressCounts[runtime.currentTargetId!] ?? 0) <= (config.coachingPolicy?.focusedRetryLimit ?? 0));
    const q = (focusedRetry ? candidates.find((q) => q.equivalentGroup === current?.equivalentGroup) : undefined) ?? candidates.find((q) => !answeredGroups.has(q.equivalentGroup)) ?? candidates[0] ?? manifest.diagnosticQuestions.find((q) => q.equivalentGroup === current?.equivalentGroup && q.id !== current.id) ?? manifest.diagnosticQuestions[0];
    return q ? { questionId: q.id, groupId: q.equivalentGroup, targetId: q.targetConcepts[0], caseId: null, questionType: "CONCEPT_CLARIFICATION", hintLevel: 0, assistantMessage: q.questionText } : null;
  }
  if (s.pedagogicalStage === "CASE_TRANSFER") {
    if (s.lastResult === "NEED_VERIFY" && s.currentCaseId) {
      const c = manifest.cases.find((c) => c.id === s.currentCaseId)!;
      return { questionId: `CASE_VERIFY_${c.id}`, groupId: "SQG_SR_010", targetId: "COMP_SR_TRANSFER", caseId: c.id, questionType: "EVIDENCE_PROBE", hintLevel: 0, assistantMessage: `请独立核验同一情境的关键依据。\n\n${c.studentText}\n\n哪一条具体事实支持你的因果判断，条件改变后这一判断是否仍然成立？` };
    }
    const variants = new Set(manifest.cases.filter((c) => runtime.usedCaseIds.includes(c.id)).map((c) => c.variantGroupId));
    const candidates = [...manifest.cases].sort((a, b) => Number(runtime.usedCaseIds.includes(a.id)) - Number(runtime.usedCaseIds.includes(b.id)) || Number(variants.has(a.variantGroupId)) - Number(variants.has(b.variantGroupId)) || Number(!a.targetUnits.includes(runtime.currentTargetId!)) - Number(!b.targetUnits.includes(runtime.currentTargetId!)) || Math.abs(a.difficulty - 3) - Math.abs(b.difficulty - 3) || (runtime.caseExposureCounts[a.id] ?? 0) - (runtime.caseExposureCounts[b.id] ?? 0) || (s.caseLastUsedAt[a.id] ?? "").localeCompare(s.caseLastUsedAt[b.id] ?? ""));
    const c = candidates[0];
    return c ? { questionId: `CASE_QUESTION_${c.id}`, groupId: "SQG_SR_010", targetId: "COMP_SR_TRANSFER", caseId: c.id, questionType: "TRANSFER", hintLevel: 0, assistantMessage: `教学合成案例\n\n${c.studentText}\n\n${config.cases[c.id].studentQuestions}` } : null;
  }
  const currentTarget = runtime.currentTargetId!;
  const noProgress = s.noProgressCounts[currentTarget] ?? 0;
  const hintLevel = runtime.hintLevels[currentTarget] ?? 0;
  const lastAssessment = s.assessments[s.lastAssessmentMessageId ?? s.diagnosticMessageIds.at(-1) ?? ""];
  const lastRule = config.groups[s.currentGroupId!]?.rule;
  const contentResult = lastAssessment && lastRule ? evaluateEvidenceRule(lastRule, lastAssessment.evidence.map((e) => e.evidenceId)) : s.lastResult;
  const edgeCondition = lastAssessment?.contradictions.length ? "contradictory" : s.lastResult === "PASS" ? "success" : hintLevel === 1 && contentResult !== "PASS" ? "fail_after_hint_1" : noProgress >= 2 && hintLevel === 0 ? "fail_twice" : s.lastResult === "NEED_VERIFY" ? "contradictory" : null;
  const edge = config.edges.find((e) => (e.from === s.currentGroupId || e.from === "ANY_GROUP") && e.condition === edgeCondition);
  if (edge?.to.startsWith("HINT_LEVEL") && hintLevel < 2) return selectV12Action(manifest, runtime, now, true);
  const isMastered = (id: string) => s.unitStates[id]?.status === "MASTERED";
  const priorityError = Object.values(s.misconceptionStates).find((c) => c.status !== "RESOLVED");
  const priorityTarget = priorityError ? config.errors[priorityError.claimId]?.targetId : null;
  const groups = manifest.questionGroups.filter((g) => !isMastered(g.targetId) && config.groups[g.id].prerequisites.every(isMastered));
  const triggered = (id: string) => {
    const g = config.groups[id];
    return g.triggerGaps.some((gap) => s.gapStates[gap]?.status !== "RESOLVED" && Boolean(s.gapStates[gap])) || g.triggerFlags.some((flag) => runtime.flags.includes(flag)) || g.triggerCategories.some((category) => manifest.misconceptions.some((e) => e.category === category && s.misconceptionStates[e.id] && s.misconceptionStates[e.id].status !== "RESOLVED"));
  };
  groups.sort((a, b) => Number(b.targetId === priorityTarget) - Number(a.targetId === priorityTarget) || Number(b.id === edge?.to) - Number(a.id === edge?.to) || Number(b.id === s.currentGroupId && s.lastResult !== "PASS") - Number(a.id === s.currentGroupId && s.lastResult !== "PASS") || Number(triggered(b.id)) - Number(triggered(a.id)) || (runtime.targetAttempts[a.targetId] ?? 0) - (runtime.targetAttempts[b.targetId] ?? 0));
  const group = groups.find((g) => g.memberIds.some((id) => !runtime.usedQuestionIds.includes(id))) ?? groups[0];
  if (!group) return null;
  const desiredDifficulty = s.lastResult === "PASS" ? 3 : noProgress >= 2 || s.lastResult === "FAIL" ? 1 : 2;
  const questions = manifest.socraticQuestions.filter((q) => group.memberIds.includes(q.id)).sort((a, b) => Number(runtime.usedQuestionIds.includes(a.id)) - Number(runtime.usedQuestionIds.includes(b.id)) || Math.abs(a.difficulty - desiredDifficulty) - Math.abs(b.difficulty - desiredDifficulty));
  const q = questions[0];
  return q ? { questionId: q.id, groupId: group.id, targetId: group.targetId, caseId: null, questionType: q.questionType, hintLevel: 0, assistantMessage: q.questionText } : null;
}

export function recordV12Action(runtime: KnowledgeRuntime, action: KnowledgeAction, now: string): KnowledgeRuntime {
  const next = structuredClone(runtime);
  const s = next.v12!;
  const continuingCase = Boolean(action.caseId && action.caseId === s.currentCaseId && s.lastResult === "NEED_VERIFY");
  next.currentQuestionId = action.questionId; next.currentTargetId = action.targetId;
  s.currentGroupId = action.groupId;
  s.currentCaseId = action.caseId;
  if (action.hintLevel) {
    next.hintLevels[action.targetId] = action.hintLevel;
    s.activityType = "HINT";
  } else {
    if (!next.usedQuestionIds.includes(action.questionId)) next.usedQuestionIds.push(action.questionId);
    s.usedGroupIds = [...new Set([...s.usedGroupIds, action.groupId])];
    s.activityType = action.caseId ? "CASE_ANALYSIS" : s.pedagogicalStage === "DIAGNOSIS" ? "DIAGNOSTIC_QUESTION" : s.lastResult === "NEED_VERIFY" ? "VERIFY" : "QUESTION";
    if (action.caseId && !continuingCase) {
      s.currentCaseUnseen = !next.usedCaseIds.includes(action.caseId);
      next.usedCaseIds = [...new Set([...next.usedCaseIds, action.caseId])];
      next.caseExposureCounts[action.caseId] = (next.caseExposureCounts[action.caseId] ?? 0) + 1;
      s.ownCaseExposureCounts[action.caseId] = (s.ownCaseExposureCounts[action.caseId] ?? 0) + 1;
      s.caseLastUsedAt[action.caseId] = now;
    }
  }
  return next;
}

export function mergeCaseExposureHistory(runtime: KnowledgeRuntime, otherSessions: KnowledgeRuntime[]): KnowledgeRuntime {
  const next = structuredClone(runtime);
  const totals: Record<string, number> = { ...next.v12!.ownCaseExposureCounts };
  // Per-session increments prevent retry-inherited totals from being counted twice.
  for (const other of otherSessions) {
    next.usedCaseIds = [...new Set([...next.usedCaseIds, ...other.usedCaseIds])];
    for (const [id, count] of Object.entries(other.v12?.ownCaseExposureCounts ?? {})) totals[id] = (totals[id] ?? 0) + count;
    for (const [id, count] of Object.entries(other.caseExposureCounts)) next.caseExposureCounts[id] = Math.max(next.caseExposureCounts[id] ?? 0, count);
    for (const [id, date] of Object.entries(other.v12?.caseLastUsedAt ?? {})) if (date > (next.v12!.caseLastUsedAt[id] ?? "")) next.v12!.caseLastUsedAt[id] = date;
  }
  for (const [id, count] of Object.entries(totals)) next.caseExposureCounts[id] = Math.max(next.caseExposureCounts[id] ?? 0, count);
  return next;
}

export function finalEvidenceIds(state: V12State): string[] {
  return [...new Set([state.finalFeynmanMessageId, state.finalTransferMessageId, state.finalRevisionMessageId].filter((id): id is string => Boolean(id)))];
}
