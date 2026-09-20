import type { KnowledgeManifest } from "./schemas";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { TurnAssessment } from "./v12-schema";
import type { SupportedGapRouting } from "./coaching-schema";
import { evaluateEvidenceRule } from "./v12-engine";

// A supported gap can guide a question without promoting uncertain evidence to mastery.
export function supportedGapRouting(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, assessment: TurnAssessment, missing: string[], messageId: string): SupportedGapRouting | undefined {
  const config = manifest.v12!;
  const policy = config.coachingPolicy!;
  const state = runtime.v12!;
  if (policy.version !== "1.2" || !policy.confidenceRouting || state.lastResult !== "NEED_VERIFY" || !missing.length) return;
  if (!["DIAGNOSIS", "KNOWLEDGE_CONSTRUCTION"].includes(state.pedagogicalStage) || state.resumeVerification || state.currentCaseId || state.activityType === "HINT") return;
  if (assessment.contradictions.length || assessment.candidateMisconceptions.length || runtime.flags.some((flag) => flag !== "FLAG_NEED_VERIFY")) return;
  const observations = state.observations.filter((item) => item.ref.messageId === messageId);
  if (!observations.length || observations.some((item) => !item.independent || item.confidence !== assessment.modelAssessmentConfidence)) return;
  const observed = new Set(assessment.evidence.map((item) => item.evidenceId));
  if ([...observed].some((id) => !observations.some((item) => item.evidenceId === id)) || Object.values(config.errors).some((error) => observed.has(error.evidenceId))) return;
  const threshold = policy.minimumConfidence;
  const candidates = [...assessment.candidateMastery, ...assessment.candidateGaps];
  if (assessment.modelAssessmentConfidence >= threshold || Math.min(...candidates.map((item) => item.modelConfidence)) !== assessment.modelAssessmentConfidence) return;
  if (assessment.candidateGaps.some((item) => item.modelConfidence < threshold)) return;
  const uncertainMastery = assessment.candidateMastery.filter((item) => item.modelConfidence < threshold);
  if (!uncertainMastery.length || uncertainMastery.some((item) => item.unitId !== runtime.currentTargetId || !config.unitRules[item.unitId] || evaluateEvidenceRule(config.unitRules[item.unitId], observed) === "PASS")) return;
  for (const rule of [...policy.confidenceRouting.rules].sort((a, b) => a.id.localeCompare(b.id))) {
    const gaps = assessment.candidateGaps.filter((item) => item.id === rule.gapId);
    const missingEvidenceIds = missing.filter((id) => rule.absentAll.includes(id));
    if (rule.targetId !== runtime.currentTargetId || config.gaps[rule.gapId] !== rule.gapTargetId || !gaps.length || !missingEvidenceIds.length) continue;
    if (!rule.requiredAll.every((id) => observed.has(id)) || rule.absentAll.some((id) => observed.has(id))) continue;
    return { ruleId: rule.id, candidateGapId: rule.gapId, confidence: Math.min(...gaps.map((item) => item.modelConfidence)), missingEvidenceIds };
  }
}
