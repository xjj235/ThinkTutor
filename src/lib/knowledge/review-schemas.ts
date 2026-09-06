import { z } from "zod";
import { claimSchema } from "./v12-schema";
export const sourceReviewSchema = z.object({ unitId: z.string().min(1), title: z.string().min(1).max(200), author: z.string().min(1).max(120), year: z.number().int().min(1900).max(2200), location: z.string().min(1).max(300), checksum: z.string().regex(/^[a-f0-9]{64}$/u), verifiedBy: z.string(), verifiedAt: z.string() }).strict();
export const sourceReviewsSchema = z.array(sourceReviewSchema).max(100);
export const goldenItemSchema = z.object({
  priorAnswers: z.array(z.string().min(12).max(4000)).max(10).default([]), caseId: z.string().nullable().default(null),
  id: z.string().min(1), studentAnswer: z.string().min(12).max(4000), targetId: z.string().min(1),
  expectedEvidenceIds: z.array(z.string()), expectedErrorIds: z.array(z.string()), expectedLevel: z.enum(["L1", "L2", "L3", "L4"]),
  expectedGapIds: z.array(z.string()).default([]), resolvedClaimIds: z.array(z.string()).default([]), unresolvedClaimIds: z.array(z.string()).default([]),
  scenarios: z.array(z.enum(["HINT_CORRECTION", "COUNTEREXAMPLE", "FLUENT_WRONG", "INSUFFICIENT_EVIDENCE", "UNSEEN_PASS", "UNSEEN_FAIL"])).default([]),
  dimensionAnchors: z.object({ conceptCompleteness: z.number().int().min(0).max(20).multipleOf(5), logicCompleteness: z.number().int().min(0).max(20).multipleOf(5), expressionClarity: z.number().int().min(0).max(20).multipleOf(5), exampleAbility: z.number().int().min(0).max(20).multipleOf(5), transferAbility: z.number().int().min(0).max(20).multipleOf(5) }).strict(),
  verifiedBy: z.string().min(1), verifiedAt: z.string(),
}).strict();
export const goldenSetSchema = z.array(goldenItemSchema).max(100);
export const releaseReviewInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE") }).strict(),
  z.object({ action: z.literal("SOURCE"), version: z.number().int(), source: sourceReviewSchema.omit({ verifiedBy: true, verifiedAt: true }) }).strict(),
  z.object({ action: z.literal("GOLDEN"), version: z.number().int(), sample: goldenItemSchema.omit({ verifiedBy: true, verifiedAt: true, id: true }) }).strict(),
  z.object({ action: z.literal("REMOVE_GOLDEN"), version: z.number().int(), sampleId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("PEDAGOGY"), version: z.number().int(), ruleId: z.string(), sourceTitle: z.string().trim().min(1).max(200), sourceLocation: z.string().trim().min(1).max(300), basisType: z.enum(["theory", "engineering_interpretation", "project_custom"]) }).strict(),
  z.object({ action: z.enum(["REFRESH_DRAFT", "FREEZE", "UNFREEZE", "REVIEW", "PUBLISH", "ARCHIVE", "VALIDATE_MODEL"]), version: z.number().int() }).strict(),
]);
export const goldenValidationSchema = z.object({ releaseId: z.string(), contentHash: z.string(), sampleHash: z.string(), modelProvider: z.enum(["mock", "deepseek"]), modelName: z.string(), promptVersion: z.string(), checkedAt: z.string(), checkedBy: z.string(), passed: z.boolean(), results: z.array(z.object({ id: z.string(), passed: z.boolean(), differences: z.array(z.string()) }).strict()) }).strict();
export const claimReviewInputSchema = z.object({ sessionId: z.string().min(1), claimId: z.string().min(1), version: z.number().int(), action: z.enum(["CONFIRM", "REJECT", "NEED_MORE_EVIDENCE"]), note: z.string().trim().min(1).max(500) }).strict();
export const claimReviewRecordSchema = z.object({ type: z.literal("KNOWLEDGE_CLAIM_REVIEW"), claimId: z.string(), action: z.enum(["CONFIRM", "REJECT", "NEED_MORE_EVIDENCE"]), note: z.string(), before: claimSchema, after: claimSchema }).strict();
