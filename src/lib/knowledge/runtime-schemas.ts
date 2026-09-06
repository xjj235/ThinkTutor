import { z } from "zod";
import { v12StateSchema } from "./v12-schema";

export const sessionVersionsSchema = z.object({
  releaseId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  knowledgeVersion: z.string().min(1),
  diagnosticVersion: z.string().min(1),
  questionGraphVersion: z.string().min(1),
  caseBankVersion: z.string().min(1),
  rubricVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  workflowVersion: z.string().min(1),
  schemaVersion: z.string().optional(),
  pedagogyVersion: z.string().optional(),
  modelProvider: z.enum(["mock", "deepseek"]),
  modelName: z.string().min(1),
}).strict();

export const knowledgeRuntimeSchema = z.object({
  schemaVersion: z.literal("2"),
  pedagogicalStage: z.enum(["DIAGNOSIS", "SOCRATIC", "CASE_TRANSFER", "FEYNMAN", "REPORT"]),
  currentTargetId: z.string().nullable(),
  currentQuestionId: z.string().nullable(),
  usedQuestionIds: z.array(z.string()).max(100),
  usedCaseIds: z.array(z.string()).max(100),
  targetAttempts: z.record(z.string(), z.number().int().nonnegative()),
  hintLevels: z.record(z.string(), z.union([z.literal(0), z.literal(1), z.literal(2)])),
  caseExposureCounts: z.record(z.string(), z.number().int().nonnegative()),
  candidateErrorIds: z.array(z.string()).max(20),
  candidateGapIds: z.array(z.string()).max(20),
  flags: z.array(z.string()).max(20),
  versions: sessionVersionsSchema,
  v12: v12StateSchema.optional(),
}).strict();

export type SessionVersions = z.infer<typeof sessionVersionsSchema>;
export type KnowledgeRuntime = z.infer<typeof knowledgeRuntimeSchema>;
