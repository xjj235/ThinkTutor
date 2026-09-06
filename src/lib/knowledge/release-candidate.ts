import type { z } from "zod";
import type { KnowledgeManifest } from "./schemas";
import type { goldenSetSchema, sourceReviewsSchema } from "./review-schemas";

export function candidateReadiness(manifest: KnowledgeManifest, sources: z.infer<typeof sourceReviewsSchema>, golden: z.infer<typeof goldenSetSchema>): string[] {
  const errors: string[] = [];
  if (manifest.knowledgeUnits.some((u) => sources.filter((s) => s.unitId === u.id && s.verifiedBy && s.verifiedAt).length !== 1)) errors.push("13个知识单元均需教师确认来源");
  if (golden.length < 20 || golden.length > 50 || new Set(golden.map((s) => s.studentAnswer.trim())).size !== golden.length) errors.push("需要20至50条不重复的教师样例");
  if (new Set(golden.map((s) => s.expectedLevel)).size !== 4) errors.push("教师样例需覆盖L1至L4");
  const requiredErrors = Object.keys(manifest.v12!.errors);
  if (requiredErrors.some((id) => !golden.some((s) => s.expectedErrorIds.includes(id)))) errors.push("教师样例需覆盖五类正式错误");
  if (["GAP_COMMON_EXPOSURE", "GAP_FIRE_SALE", "GAP_CAUSAL_CHAIN", "GAP_TRANSFER"].some((id) => !golden.some((s) => s.expectedGapIds.includes(id)))) errors.push("教师样例需覆盖四类关键缺口");
  if (["HINT_CORRECTION", "COUNTEREXAMPLE", "FLUENT_WRONG", "INSUFFICIENT_EVIDENCE", "UNSEEN_PASS", "UNSEEN_FAIL"].some((id) => !golden.some((s) => s.scenarios.some((scenario) => scenario === id)))) errors.push("教师样例缺少必需场景");
  if (manifest.v12!.pedagogyRules.some((r) => !r.verifiedBy || !r.verifiedAt)) errors.push("18条教学规则均需来源核验");
  return errors;
}

export function mergeCandidateSources(manifest: KnowledgeManifest, sources: z.infer<typeof sourceReviewsSchema>): KnowledgeManifest {
  const candidate = structuredClone(manifest);
  candidate.sources = candidate.sources.filter((s) => !s.id.startsWith("TEACHER_SOURCE_"));
  for (const unit of candidate.knowledgeUnits) unit.sourceRefs = unit.sourceRefs.filter((r) => !r.sourceId.startsWith("TEACHER_SOURCE_"));
  for (const source of sources) {
    const id = `TEACHER_SOURCE_${source.unitId}`;
    candidate.sources.push({ id, title: source.title, author: source.author, year: source.year, location: source.location, sourceType: "teacher_material", checksum: source.checksum, version: "1.2", status: "reviewed" });
    candidate.knowledgeUnits.find((u) => u.id === source.unitId)!.sourceRefs.push({ sourceId: id, sourceLocator: source.location, confidence: 1 });
  }
  // The explicit freeze operation confirms the complete candidate and its provenance.
  for (const source of candidate.sources) source.status = "reviewed";
  for (const rule of candidate.v12!.pedagogyRules) rule.status = "PUBLISHED";
  return candidate;
}
