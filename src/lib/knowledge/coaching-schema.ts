import { z } from "zod";

export const coachingDimensionSchema = z.enum(["CONCEPT", "MECHANISM", "CONDITION", "EVIDENCE", "TRANSFER"]);
export const coachingKindSchema = z.enum(["GOAL", "DIAGNOSIS", "QUESTION", "HINT", "CASE", "FEYNMAN", "REFLECTION", "REPORT", "RETRY", "RESUME"]);
const levelSchema = z.enum(["L1", "L2", "L3", "L4"]);
const evidenceIds = z.array(z.string().min(1)).max(80);
export const coachingSignalSchema = z.enum(["UNRELIABLE", "MISCONCEPTION", "MISSING", "VERIFY", "INITIAL"]);
export const routingExecutionSchema = z.object({
  priority: z.number().int().min(1).max(1000),
  dimensionSelection: z.enum(["FIXED", "MISSING_FIRST"]),
  dimension: coachingDimensionSchema,
}).strict();
export const coachingVerificationRuleSchema = z.object({
  id: z.string().min(1), targetIds: evidenceIds.min(1), requiredAll: evidenceIds.min(1),
  description: z.string().min(1).max(500),
}).strict();
export const coachingPolicySchema = z.object({
  version: z.enum(["1.0", "1.1", "1.2"]), basisType: z.literal("project_custom"), reviewStatus: z.literal("draft"),
  minimumConfidence: z.literal(0.75), focusedRetryLimit: z.number().int().min(1).max(3),
  confidenceRouting: z.object({
    mode: z.literal("SUPPORTED_GAP_WITHOUT_MASTERY"), description: z.string().min(1).max(1000),
    rules: z.array(z.object({ id: z.string().min(1), targetId: z.string().min(1), gapId: z.string().min(1), gapTargetId: z.string().min(1), requiredAll: evidenceIds.min(1), absentAll: evidenceIds.min(1), description: z.string().min(1).max(500) }).strict()).min(1).max(30),
  }).strict().optional(),
  generation: z.object({ mode: z.literal("GROUNDED_FOLLOW_UP"), maxQuestionChars: z.number().int().min(120).max(500), recentTurnLimit: z.number().int().min(2).max(8), instructions: z.array(z.string().min(1)).min(4).max(12) }).strict().optional(),
  dimensionPriority: z.array(coachingDimensionSchema).length(5),
  dimensions: z.record(coachingDimensionSchema, z.object({ label: z.string(), evidenceIds, criterion: z.string() }).strict()),
  levelCriteria: z.record(levelSchema, z.string()),
  routingRules: z.array(z.object({ id: z.string().min(1), signal: coachingSignalSchema, description: z.string().min(1), execution: routingExecutionSchema.optional() }).strict()).length(5),
  verificationRules: z.array(coachingVerificationRuleSchema).max(30).optional(),
  forms: z.array(z.object({ id: z.string(), label: z.string(), dimension: coachingDimensionSchema, levels: z.array(levelSchema).min(1), questionType: z.enum(["CONCEPT_CLARIFICATION", "CAUSE_PROBE", "ASSUMPTION_TEST", "COUNTEREXAMPLE", "EVIDENCE_PROBE", "TRANSFER"]), template: z.string().min(10).max(350) }).strict()).min(12).max(30),
  openings: z.array(z.object({ id: z.string(), text: z.string().max(120) }).strict()).min(2).max(6),
  stageFrames: z.record(coachingKindSchema, z.array(z.object({ id: z.string(), template: z.string().max(350) }).strict()).min(2).max(4)),
  scoreCriteria: z.object({ conceptCompleteness: z.array(evidenceIds.min(1)).length(4), logicCompleteness: z.array(evidenceIds.min(1)).length(4), expressionClarity: z.array(evidenceIds.min(1)).length(4), exampleAbility: z.array(evidenceIds.min(1)).length(4), transferAbility: z.array(evidenceIds.min(1)).length(4) }).strict(),
}).strict().superRefine((policy, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if (new Set(policy.routingRules.map((rule) => rule.id)).size !== 5 || new Set(policy.routingRules.map((rule) => rule.signal)).size !== 5) issue("Routing IDs and signals must be unique and complete");
  if (policy.version === "1.2" ? !policy.confidenceRouting : Boolean(policy.confidenceRouting)) issue("Supported-gap routing requires policy version 1.2");
  if (policy.version === "1.0") {
    if (policy.verificationRules || policy.routingRules.some((rule) => rule.execution)) issue("Legacy policies cannot override executable rules; upgrade the policy version");
    return;
  }
  if (!policy.verificationRules || policy.routingRules.some((rule) => !rule.execution)) issue("Executable policies require routing and verification rules");
  const priorities = policy.routingRules.map((rule) => rule.execution?.priority);
  if (new Set(priorities).size !== 5) issue("Routing priorities must be unique");
  const priority = (signal: string) => policy.routingRules.find((rule) => rule.signal === signal)?.execution?.priority ?? 0;
  if (!(priority("UNRELIABLE") > priority("MISCONCEPTION") && priority("MISCONCEPTION") > priority("MISSING") && priority("MISSING") > priority("VERIFY"))) issue("Verification of unreliable evidence must precede errors, gaps and advancement");
  const unreliable = policy.routingRules.find((rule) => rule.signal === "UNRELIABLE")?.execution;
  if (unreliable?.dimensionSelection !== "FIXED" || unreliable.dimension !== "EVIDENCE") issue("Unreliable evidence must route to evidence verification");
});
export type CoachingPolicy = z.infer<typeof coachingPolicySchema>;
export type CoachingKind = z.infer<typeof coachingKindSchema>;
export const supportedGapRoutingSchema = z.object({
  ruleId: z.string(), candidateGapId: z.string(), confidence: z.number().min(0.75).max(1), missingEvidenceIds: evidenceIds.min(1),
}).strict();
export type SupportedGapRouting = z.infer<typeof supportedGapRoutingSchema>;
export const coachingProfileSchema = z.object({
  targetId: z.string().nullable(), level: levelSchema, dimension: coachingDimensionSchema,
  reasonId: z.string(), observedEvidenceIds: evidenceIds, missingEvidenceIds: evidenceIds,
  basisMessageId: z.string().nullable(), verifiedLevel: z.boolean(),
  ruleDecision: z.object({
    signal: coachingSignalSchema, questionId: z.string().nullable(), stage: z.string().nullable(),
    matchedRoutingRuleIds: evidenceIds, verificationRuleIds: evidenceIds,
    reason: z.string().min(1).max(2000),
    supportedGap: supportedGapRoutingSchema.optional(),
  }).strict().optional(),
}).strict();
export type CoachingProfile = z.infer<typeof coachingProfileSchema>;
export const generatedFollowUpSchema = z.object({
  question: z.string().trim().min(10).max(500),
  studentAnchor: z.string().trim().min(1).max(100),
  focusEvidenceIds: evidenceIds.min(1),
  sourceIds: z.array(z.string().min(1)).min(1).max(8),
}).strict();
export const coachingDecisionSchema = z.object({ choiceId: z.string().min(1), openingId: z.string().min(1), followUp: generatedFollowUpSchema.optional() }).strict();
export type CoachingDecision = z.infer<typeof coachingDecisionSchema>;
export const coachingPromptSchema = z.object({ questionId: z.string().nullable(), stage: z.string(), text: z.string().min(1).max(8000), rule: z.object({ requiredAll: evidenceIds, requiredAny: evidenceIds, prohibited: evidenceIds }).strict() }).strict();
export const coachingDecisionBasisSchema = z.object({
  policyVersion: z.enum(["1.0", "1.1", "1.2"]), releaseId: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  assessedTargetId: z.string().nullable(), assessedQuestionId: z.string().nullable(), assessedStage: z.string().nullable(), basisMessageId: z.string().nullable(),
  selectedTargetId: z.string().nullable(), matchedRuleIds: evidenceIds, selectedRuleId: z.string(), reason: z.string().min(1).max(3000),
  assessment: z.object({
    result: z.enum(["PASS", "PARTIAL", "FAIL", "NEED_VERIFY"]).nullable(),
    confidence: z.number().min(0).max(1), minimumConfidence: z.number().min(0).max(1),
    supportedGap: supportedGapRoutingSchema.optional(),
    contradictions: evidenceIds, flags: evidenceIds,
    candidates: z.array(z.object({ kind: z.enum(["MASTERY", "MISCONCEPTION", "GAP"]), id: z.string(), confidence: z.number().min(0).max(1) }).strict()).max(60),
  }).strict().nullable().optional(),
  evidence: z.array(z.object({ evidenceId: z.string(), messageId: z.string(), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(), extractedText: z.string().min(1).max(4000) }).strict().refine((ref) => ref.endOffset > ref.startOffset, "Invalid evidence range")).max(80),
  questionRequirements: coachingPromptSchema.shape.rule.nullable(),
}).strict();
export type CoachingDecisionBasis = z.infer<typeof coachingDecisionBasisSchema>;
export const coachingTraceSchema = z.object({
  kind: coachingKindSchema, profile: coachingProfileSchema, choiceId: z.string(), openingId: z.string(),
  followUp: generatedFollowUpSchema.optional(),
  decisionBasis: coachingDecisionBasisSchema.optional(),
  questionId: z.string().nullable(), caseId: z.string().nullable(), provider: z.enum(["mock", "deepseek"]), model: z.string(), requestId: z.string(), createdAt: z.string(),
}).strict();
