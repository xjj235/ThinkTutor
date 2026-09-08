import { z } from "zod";

export const coachingDimensionSchema = z.enum(["CONCEPT", "MECHANISM", "CONDITION", "EVIDENCE", "TRANSFER"]);
export const coachingKindSchema = z.enum(["GOAL", "DIAGNOSIS", "QUESTION", "HINT", "CASE", "FEYNMAN", "REFLECTION", "REPORT", "RETRY", "RESUME"]);
const levelSchema = z.enum(["L1", "L2", "L3", "L4"]);
const evidenceIds = z.array(z.string().min(1)).max(80);
export const coachingPolicySchema = z.object({
  version: z.literal("1.0"), basisType: z.literal("project_custom"), reviewStatus: z.literal("draft"),
  minimumConfidence: z.literal(0.75), focusedRetryLimit: z.number().int().min(1).max(3),
  generation: z.object({ mode: z.literal("GROUNDED_FOLLOW_UP"), maxQuestionChars: z.number().int().min(120).max(500), recentTurnLimit: z.number().int().min(2).max(8), instructions: z.array(z.string().min(1)).min(4).max(12) }).strict().optional(),
  dimensionPriority: z.array(coachingDimensionSchema).length(5),
  dimensions: z.record(coachingDimensionSchema, z.object({ label: z.string(), evidenceIds, criterion: z.string() }).strict()),
  levelCriteria: z.record(levelSchema, z.string()),
  routingRules: z.array(z.object({ id: z.string(), signal: z.enum(["UNRELIABLE", "MISCONCEPTION", "MISSING", "VERIFY", "INITIAL"]), description: z.string() }).strict()).length(5),
  forms: z.array(z.object({ id: z.string(), label: z.string(), dimension: coachingDimensionSchema, levels: z.array(levelSchema).min(1), questionType: z.enum(["CONCEPT_CLARIFICATION", "CAUSE_PROBE", "ASSUMPTION_TEST", "COUNTEREXAMPLE", "EVIDENCE_PROBE", "TRANSFER"]), template: z.string().min(10).max(350) }).strict()).min(12).max(30),
  openings: z.array(z.object({ id: z.string(), text: z.string().max(120) }).strict()).min(2).max(6),
  stageFrames: z.record(coachingKindSchema, z.array(z.object({ id: z.string(), template: z.string().max(350) }).strict()).min(2).max(4)),
  scoreCriteria: z.object({ conceptCompleteness: z.array(evidenceIds.min(1)).length(4), logicCompleteness: z.array(evidenceIds.min(1)).length(4), expressionClarity: z.array(evidenceIds.min(1)).length(4), exampleAbility: z.array(evidenceIds.min(1)).length(4), transferAbility: z.array(evidenceIds.min(1)).length(4) }).strict(),
}).strict();
export type CoachingPolicy = z.infer<typeof coachingPolicySchema>;
export type CoachingKind = z.infer<typeof coachingKindSchema>;
export const coachingProfileSchema = z.object({
  targetId: z.string().nullable(), level: levelSchema, dimension: coachingDimensionSchema,
  reasonId: z.string(), observedEvidenceIds: evidenceIds, missingEvidenceIds: evidenceIds,
  basisMessageId: z.string().nullable(), verifiedLevel: z.boolean(),
}).strict();
export type CoachingProfile = z.infer<typeof coachingProfileSchema>;
export const generatedFollowUpSchema = z.object({
  question: z.string().trim().min(10).max(500),
  studentAnchor: z.string().trim().min(2).max(100),
  focusEvidenceIds: evidenceIds.min(1),
  sourceIds: z.array(z.string().min(1)).min(1).max(8),
}).strict();
export const coachingDecisionSchema = z.object({ choiceId: z.string().min(1), openingId: z.string().min(1), followUp: generatedFollowUpSchema.optional() }).strict();
export type CoachingDecision = z.infer<typeof coachingDecisionSchema>;
export const coachingPromptSchema = z.object({ questionId: z.string().nullable(), stage: z.string(), text: z.string().min(1).max(8000), rule: z.object({ requiredAll: evidenceIds, requiredAny: evidenceIds, prohibited: evidenceIds }).strict() }).strict();
export const coachingTraceSchema = z.object({
  kind: coachingKindSchema, profile: coachingProfileSchema, choiceId: z.string(), openingId: z.string(),
  followUp: generatedFollowUpSchema.optional(),
  questionId: z.string().nullable(), caseId: z.string().nullable(), provider: z.enum(["mock", "deepseek"]), model: z.string(), requestId: z.string(), createdAt: z.string(),
}).strict();
