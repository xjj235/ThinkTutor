import type { KnowledgeManifest } from "./schemas";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { EvidenceRule } from "./v12-schema";
import { activeRule } from "./v12-engine";

export function buildAssessmentRules(manifest: KnowledgeManifest, runtime: KnowledgeRuntime): Record<string, EvidenceRule> {
  const config = manifest.v12!;
  const target = manifest.knowledgeUnits.find((unit) => unit.id === runtime.currentTargetId);
  const targets = [runtime.currentTargetId, ...(target?.prerequisites ?? []), ...(config.cases[runtime.v12!.currentCaseId ?? ""]?.criticalSteps ?? [])];
  const rules: Record<string, EvidenceRule> = { CURRENT_QUESTION: activeRule(manifest, runtime) };
  for (const id of targets) {
    const rule = id ? config.unitRules[id] ?? config.relationRules[id] : undefined;
    if (id && rule) rules[id] = rule;
  }
  // Scoring observes all demonstrated evidence, even when a narrower target is asked.
  for (const [dimension, tiers] of Object.entries(config.coachingPolicy?.scoreCriteria ?? {})) {
    for (const [index, ids] of tiers.entries()) {
      rules[`RUBRIC_${dimension}_${index + 1}`] = { requiredAll: [], requiredAny: [...ids], prohibited: [] };
    }
  }
  return rules;
}
