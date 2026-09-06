import { z } from "zod";

const ids = z.array(z.string().min(1));
export const evidenceRuleSchema = z.object({ requiredAll: ids, requiredAny: ids, prohibited: ids }).strict();
const stageSchema = z.enum(["GOAL_PRESENTATION", "DIAGNOSIS", "KNOWLEDGE_CONSTRUCTION", "CASE_TRANSFER", "FEYNMAN_OUTPUT", "REFLECTION", "REPORT"]);
const activitySchema = z.enum(["GOAL_PRESENTATION", "DIAGNOSTIC_QUESTION", "QUESTION", "VERIFY", "HINT", "CASE_ANALYSIS", "INDEPENDENT_EXPLANATION", "REFLECTION_REVISION", "FORMATIVE_REPORT"]);
export const pedagogyRuleSchema = z.object({
  id: z.string().regex(/^PED_\d{3}$/u), description: z.string(), scope: z.array(stageSchema).min(1),
  priority: z.union([z.literal(100), z.literal(200), z.literal(300)]), priorityLabel: z.enum(["medium", "high", "critical"]),
  basisType: z.enum(["theory", "engineering_interpretation", "project_custom"]),
  trigger: z.object({ event: z.enum(["TURN_ASSESSED", "ACTION_SELECTED", "REPORT_BUILT"]) }).strict(),
  precondition: z.object({ signal: z.enum(["ALWAYS", "UNRELIABLE", "MAJOR_ERROR", "NO_PROGRESS", "MASTERED"]) }).strict(),
  effect: z.object({ action: z.enum(["VERIFY", "PRIORITIZE_ERROR", "SCAFFOLD", "SKIP_MASTERED", "SERVER_POLICY"]) }).strict(),
  sourceType: z.enum(["theory", "engineering", "project"]), sourceTitle: z.string(), sourceLocation: z.string(),
  version: z.literal("1.2.1"), status: z.enum(["DRAFT", "PUBLISHED"]), verifiedBy: z.string().nullable(), verifiedAt: z.string().nullable(),
}).strict();
export const v12ResourcesSchema = z.object({
  specVersion: z.literal("1.2.1"),
  sourceDocumentHashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
  evidenceDefinitions: z.record(z.string(), z.string().min(1)),
  relations: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), relation: z.string(), scope: z.enum(["mastery_dependency", "conceptual_relation"]) }).strict()),
  competencies: z.array(z.object({ id: z.string(), description: z.string() }).strict()),
  pedagogyRules: z.array(pedagogyRuleSchema),
  aliases: z.record(z.string(), z.object({ accepted: ids, forbidden: ids }).strict()),
  unitRules: z.record(z.string(), evidenceRuleSchema),
  relationRules: z.record(z.string(), evidenceRuleSchema),
  unitSourceRefs: z.record(z.string(), z.object({ contentSourceRefs: ids.min(1), teachingSourceRefs: ids.min(1), assessmentSourceRefs: ids.min(1) }).strict()),
  diagnosticRules: z.record(z.string(), evidenceRuleSchema),
  groups: z.record(z.string(), z.object({ primaryTargetId: z.string(), prerequisites: ids, secondaryTargets: ids, triggerErrors: ids, triggerGaps: ids, triggerCategories: ids, triggerFlags: ids, rule: evidenceRuleSchema }).strict()),
  errors: z.record(z.string(), z.object({ evidenceId: z.string(), targetId: z.string(), resolutionRule: evidenceRuleSchema }).strict()),
  gaps: z.record(z.string(), z.string()),
  edges: z.array(z.object({ from: z.string(), condition: z.enum(["success", "fail_twice", "fail_after_hint_1", "contradictory"]), to: z.string() }).strict()),
  cases: z.record(z.string(), z.object({ synthetic: z.literal(true), studentQuestions: z.string(), criticalSteps: ids, followUp: z.record(z.string(), z.string()), rule: evidenceRuleSchema }).strict()),
}).strict();
export type EvidenceRule = z.infer<typeof evidenceRuleSchema>;
export type V12Resources = z.infer<typeof v12ResourcesSchema>;

export const evidenceRefSchema = z.object({
  messageId: z.string().min(1), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(), extractedText: z.string().min(1),
}).strict().refine((r) => r.endOffset > r.startOffset, "Invalid evidence range");
export const turnAssessmentSchema = z.object({
  evidence: z.array(z.object({ evidenceId: z.string(), messageId: z.string(), extractedText: z.string().min(1).max(4000) }).strict()).max(80),
  candidateMisconceptions: z.array(z.object({ id: z.string(), modelConfidence: z.number().min(0).max(1) }).strict()).max(20),
  candidateGaps: z.array(z.object({ id: z.string(), modelConfidence: z.number().min(0).max(1) }).strict()).max(20),
  candidateMastery: z.array(z.object({ unitId: z.string(), modelConfidence: z.number().min(0).max(1) }).strict()).max(20),
  modelAssessmentConfidence: z.number().min(0).max(1), contradictions: ids.max(20), recommendTransition: z.boolean(),
}).strict();
export type TurnAssessment = z.infer<typeof turnAssessmentSchema>;
// Stored assessments include a server-derived aggregate; the model contract does not.
export const modelTurnAssessmentSchema = turnAssessmentSchema.omit({ modelAssessmentConfidence: true }).strict();
export function normalizeModelAssessment(raw: unknown): TurnAssessment {
  const result = modelTurnAssessmentSchema.parse(raw);
  const confidences = [...result.candidateMisconceptions, ...result.candidateGaps, ...result.candidateMastery].map((c) => c.modelConfidence);
  return turnAssessmentSchema.parse({ ...result, modelAssessmentConfidence: confidences.length ? Math.min(...confidences) : 0.3 });
}
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export const tutorResponseSchema = z.object({ assistantMessage: z.string().min(1).max(8000) }).strict();
export const finalClaimSchema = z.object({ id: z.string(), type: z.enum(["MISCONCEPTION", "GAP"]), status: z.enum(["RESOLVED", "UNRESOLVED", "CANDIDATE"]), evidenceRefs: z.array(evidenceRefSchema), confidence: z.number().min(0).max(1) }).strict();
export const claimSchema = z.object({
  claimId: z.string(), status: z.enum(["CANDIDATE", "CONFIRMED", "RESOLVED", "UNRESOLVED"]),
  modelAssessmentConfidence: z.number().min(0).max(1), evidenceConsistency: z.number().min(0).max(1),
  verificationCount: z.number().int().nonnegative(), contradictionCount: z.number().int().nonnegative(),
  systemConfidence: z.number().min(0).max(1), evidenceRefs: z.array(evidenceRefSchema),
}).strict();
export const v12StateSchema = z.object({
  schemaVersion: z.literal("1.2"),
  pedagogicalStage: stageSchema,
  activityType: activitySchema,
  goalPresentedAt: z.string().nullable().default(null), goalConfirmedAt: z.string().nullable().default(null),
  stageTransitions: z.array(z.object({ fromStage: stageSchema.nullable(), toStage: stageSchema, reasonCode: z.enum(["GOAL_PRESENTED", "GOAL_CONFIRMED", "DIAGNOSIS_STABLE", "CONSTRUCTION_CRITERIA_MET", "CASE_PASSED", "CASE_REPAIR_REQUIRED", "FEYNMAN_MAJOR_BACKTRACK", "FEYNMAN_COMPLETED", "REFLECTION_COMPLETED", "EXPERIENCE_LIMIT", "SESSION_RESUMED", "RESUMED_REVERIFIED", "RESUME_GAP_IDENTIFIED"]), evidenceRefs: z.array(evidenceRefSchema), actor: z.enum(["SYSTEM", "TEACHER"]), createdAt: z.string() }).strict()).default([]),
  resumeVerification: z.object({ stage: stageSchema, activityType: activitySchema, questionId: z.string().nullable(), targetId: z.string().nullable(), groupId: z.string().nullable(), caseId: z.string().nullable(), assistantMessage: z.string(), requestedAt: z.string() }).strict().nullable().default(null),
  finalClaims: z.array(finalClaimSchema).default([]), appliedPedagogyRuleIds: ids.default([]),
  diagnosticLevel: z.enum(["L1", "L2", "L3", "L4"]).nullable(), diagnosticMessageIds: ids,
  currentGroupId: z.string().nullable(), currentCaseId: z.string().nullable(), currentCaseUnseen: z.boolean(),
  unitStates: z.record(z.string(), z.object({
    status: z.enum(["UNKNOWN", "GAP", "PARTIAL", "MASTERED"]), evidenceRefs: z.array(evidenceRefSchema), independentEvidenceCount: z.number().int().nonnegative(),
    verificationCount: z.number().int().nonnegative(), questionIds: ids, lastUpdatedAt: z.string(),
  }).strict()),
  misconceptionStates: z.record(z.string(), claimSchema), gapStates: z.record(z.string(), claimSchema),
  flagStates: z.record(z.string(), claimSchema).default({}),
  observations: z.array(z.object({ evidenceId: z.string(), ref: evidenceRefSchema, independent: z.boolean(), confidence: z.number().min(0).max(1) }).strict()),
  assessments: z.record(z.string(), turnAssessmentSchema),
  noProgressCounts: z.record(z.string(), z.number().int().nonnegative()), usedGroupIds: ids,
  caseLastUsedAt: z.record(z.string(), z.string()),
  ownCaseExposureCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  lastResult: z.enum(["PASS", "PARTIAL", "FAIL", "NEED_VERIFY"]).nullable(),
  transferPassed: z.boolean(), finalTransferMessageId: z.string().nullable(), finalFeynmanMessageId: z.string().nullable(), finalRevisionMessageId: z.string().nullable(),
  reflectionTargetId: z.string().nullable(), needsTeacherReview: z.boolean(), experienceLimitReached: z.boolean(),
  migrationLog: ids,
}).strict();
export type V12State = z.infer<typeof v12StateSchema>;
