import { z } from "zod";
import { evidenceRuleSchema, modelTurnAssessmentSchema } from "../knowledge/v12-schema";
import type { TurnAssessmentInput } from "./types";

export const assessmentCandidateTargetsSchema = z.object({
  misconceptionIds: z.array(z.string().min(1)),
  gapIds: z.array(z.string().min(1)),
}).strict();
export type AssessmentCandidateTargets = z.infer<typeof assessmentCandidateTargetsSchema>;

const allowedId = (ids: string[]) => ids.length ? z.enum(ids) : z.never();

export function createModelAssessmentSchema(input: TurnAssessmentInput) {
  if (input.evaluationRules) z.record(z.string(), evidenceRuleSchema).parse(input.evaluationRules);
  const targets = assessmentCandidateTargetsSchema.parse(input.candidateTargets);
  const masteryIds = [...new Set([...input.knowledgeUnits.map((unit) => unit.id), ...(input.lockedContext.targetId ? [input.lockedContext.targetId] : [])])];
  const shape = modelTurnAssessmentSchema.shape;
  return modelTurnAssessmentSchema.extend({
    evidence: z.array(shape.evidence.element.extend({ evidenceId: allowedId(Object.keys(input.evidenceDefinitions)), messageId: z.literal(input.message.id) })).max(80),
    candidateMastery: z.array(shape.candidateMastery.element.extend({ unitId: allowedId(masteryIds) })).max(20),
    candidateMisconceptions: z.array(shape.candidateMisconceptions.element.extend({ id: allowedId(targets.misconceptionIds) })).max(20),
    candidateGaps: z.array(shape.candidateGaps.element.extend({ id: allowedId(targets.gapIds) })).max(20),
  }).superRefine((assessment, context) => {
    assessment.evidence.forEach((evidence, index) => {
      if (!input.message.content.includes(evidence.extractedText)) context.addIssue({ code: "custom", path: ["evidence", index, "extractedText"], message: "Quote must be an exact substring of the current answer." });
    });
    const observed = new Set(assessment.evidence.map((evidence) => evidence.evidenceId));
    assessment.contradictions.forEach((id, index) => {
      if (!observed.has(id)) context.addIssue({ code: "custom", path: ["contradictions", index], message: "Contradiction requires a referenced evidence item." });
    });
  });
}
