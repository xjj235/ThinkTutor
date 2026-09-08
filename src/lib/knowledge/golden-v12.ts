import type { z } from "zod";
import type { AIProvider } from "../ai/types";
import { dimensionKeys } from "../contracts";
import type { KnowledgeManifest } from "./schemas";
import type { SessionVersions } from "./runtime-schemas";
import type { goldenItemSchema } from "./review-schemas";
import { initialKnowledgeRuntime } from "./orchestrator";
import { aggregateDiagnosticLevel, applyV12Assessment, selectV12Action } from "./v12-engine";
import { buildAssessmentRules } from "./assessment-context";
import { buildV12Report } from "./v12-report";
import { knowledgeContextBudget } from "./context-budget";

export async function evaluateGoldenSample(manifest: KnowledgeManifest, versions: SessionVersions, sample: z.infer<typeof goldenItemSchema>, assess: AIProvider["assessLearningTurn"]) {
  let runtime = initialKnowledgeRuntime(versions);
  const messages: Array<{ id: string; role: string; content: string }> = [];
  for (const [i, answer] of [...sample.priorAnswers, sample.studentAnswer].entries()) {
    const final = i === sample.priorAnswers.length;
    const message = { id: `${sample.id}-${i}`, role: "USER", content: answer };
    const q = manifest.diagnosticQuestions[i % manifest.diagnosticQuestions.length];
    runtime.currentQuestionId = q.id; runtime.currentTargetId = sample.targetId;
    if (final && sample.caseId) {
      if (!manifest.v12!.cases[sample.caseId]) throw new Error("Unknown golden case");
      runtime.v12!.pedagogicalStage = "CASE_TRANSFER"; runtime.v12!.currentCaseId = sample.caseId; runtime.v12!.currentCaseUnseen = true;
    }
    const assessment = await assess({ message, lockedContext: { phase: sample.caseId && final ? "SOCRATIC" : "DIAGNOSIS", stage: runtime.v12!.pedagogicalStage, targetId: sample.targetId, questionId: q.id, caseId: final ? sample.caseId : null, action: "ASSESS_EVIDENCE", hintLevel: 0, releaseId: versions.releaseId, questionText: final && sample.caseId ? manifest.v12!.cases[sample.caseId].studentQuestions : q.questionText, caseContext: final && sample.caseId ? manifest.cases.find((c) => c.id === sample.caseId)?.studentText : undefined }, evidenceDefinitions: manifest.v12!.evidenceDefinitions, aliases: manifest.v12!.aliases, evaluationRules: buildAssessmentRules(manifest, runtime), candidateTargets: { misconceptionIds: Object.keys(manifest.v12!.errors), gapIds: Object.keys(manifest.v12!.gaps) }, knowledgeUnits: manifest.knowledgeUnits.filter((u) => u.id === sample.targetId).slice(0, knowledgeContextBudget.knowledgeUnits).map(({ id, content }) => ({ id, content })) });
    runtime = applyV12Assessment(manifest, runtime, assessment, message, "2026-09-04T00:00:00.000Z");
    messages.push(message);
  }
  const state = runtime.v12!;
  state.finalFeynmanMessageId = messages.at(-1)!.id;
  const finalAssessment = state.assessments[messages.at(-1)!.id];
  const observedEvidence = new Set(finalAssessment.evidence.map((e) => e.evidenceId));
  const observedErrors = Object.entries(manifest.v12!.errors).filter(([, e]) => observedEvidence.has(e.evidenceId)).map(([id]) => id).sort();
  const { report } = buildV12Report(manifest, runtime, messages);
  const differences: string[] = [];
  if (JSON.stringify([...observedEvidence].sort()) !== JSON.stringify([...sample.expectedEvidenceIds].sort())) differences.push("evidenceIds");
  if (JSON.stringify(observedErrors) !== JSON.stringify([...sample.expectedErrorIds].sort())) differences.push("misconceptions");
  const activeGaps = Object.values(state.gapStates).filter((c) => c.status !== "RESOLVED").map((c) => c.claimId).sort();
  if (JSON.stringify(activeGaps) !== JSON.stringify([...sample.expectedGapIds].sort())) differences.push("gaps");
  const claims = { ...state.misconceptionStates, ...state.gapStates };
  if (sample.resolvedClaimIds.some((id) => claims[id]?.status !== "RESOLVED")) differences.push("resolvedClaims");
  if (sample.unresolvedClaimIds.some((id) => !["CONFIRMED", "UNRESOLVED"].includes(claims[id]?.status))) differences.push("unresolvedClaims");
  if (aggregateDiagnosticLevel(state) !== sample.expectedLevel) differences.push("diagnosticLevel");
  for (const key of dimensionKeys) if (report.dimensions[key].score / 5 !== sample.dimensionAnchors[key]) differences.push(key);
  state.pedagogicalStage = "KNOWLEDGE_CONSTRUCTION";
  return { id: sample.id, passed: !differences.length, differences, nextGroup: selectV12Action(manifest, runtime, "2026-09-04T00:00:00.000Z")?.groupId ?? null };
}
