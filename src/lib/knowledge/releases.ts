import "server-only";

import { createHash } from "node:crypto";
import { getServerEnv } from "../env";
import { AppError } from "../errors";
import { tutorSystemPrompt } from "../ai/prompts/tutor";
import { reportSystemPrompt } from "../ai/prompts/report";
import { knowledgeManifests } from "./static-manifests";
import { validateKnowledgeManifests, type KnowledgeManifest } from "./schemas";
import { prisma } from "../db";
import type { SessionVersions } from "./runtime-schemas";
import { assessmentV12Prompt } from "../ai/prompts/assessment-v12";
import { z } from "zod";
import { modelTurnAssessmentSchema } from "./v12-schema";
import { teachingV12Prompt, teachingReviewPrompt } from "../ai/prompts/teaching-v12";
import { coachingDecisionSchema } from "./coaching-schema";

export function releaseAllowed(manifest: KnowledgeManifest, environment: string, allowDraft: boolean): boolean {
  if (environment === "production" && allowDraft) return false;
  if (manifest.release.status === "archived") return false;
  if (manifest.release.status === "published") return Boolean(manifest.release.verifiedBy && manifest.release.verifiedAt);
  return ["development", "test"].includes(environment) && allowDraft;
}

export function getActiveManifests(): KnowledgeManifest[] {
  const env = getServerEnv();
  return knowledgeManifests.filter((manifest) => releaseAllowed(manifest, env.DEPLOYMENT_ENV, env.ALLOW_DRAFT_KNOWLEDGE));
}

export async function getRuntimeManifests(includeArchived = false): Promise<KnowledgeManifest[]> {
  const env = getServerEnv();
  const records = await prisma.knowledgeRelease.findMany({ where: { status: { in: ["PUBLISHED", "ARCHIVED"] } } });
  const published: KnowledgeManifest[] = [];
  for (const record of records) {
    if (record.status === "ARCHIVED" && !includeArchived) continue;
    const validation = validateKnowledgeManifests([record.manifest]);
    const m = validation.manifests[0];
    if (record.status === "ARCHIVED" && m?.release.status === "draft") continue;
    if (validation.errors.length || !m || m.release.status !== "published" || !record.verifiedBy || !record.verifiedAt || createVersionSnapshot(m).contentHash !== record.contentHash || !releaseAllowed(m, env.DEPLOYMENT_ENV, env.ALLOW_DRAFT_KNOWLEDGE)) throw new AppError("CONFLICT", "知识发布记录校验失败。", 409);
    published.push(m);
  }
  return [...getActiveManifests().filter((m) => !records.some((p) => p.id === m.release.id)), ...published];
}

export async function findKnowledgeManifest(topic: string, context: { chapter?: string | null; objective?: string } = {}): Promise<KnowledgeManifest | undefined> {
  const subjects = [topic, context.chapter, context.objective].filter((value): value is string => Boolean(value)).map((value) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " "));
  const manifest = [...await getRuntimeManifests()].reverse().find((manifest) => subjects.some((subject) => subject.includes(manifest.knowledgePoint.title.toLowerCase()) || (manifest.knowledgePoint.code === "KP_SYSTEMIC_RISK" && subject.includes("systemic risk"))));
  if (!manifest && getServerEnv().DEPLOYMENT_ENV === "production" && subjects.some((subject) => /系统性风险|systemic risk/u.test(subject))) throw new AppError("CONFLICT", "系统性风险知识版本尚未完成发布审核。", 409);
  return manifest;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => [key, canonicalValue(child)]));
  return value;
}

export function createVersionSnapshot(manifest: KnowledgeManifest): SessionVersions {
  const env = getServerEnv();
  const version = manifest.knowledgePoint.version;
  return {
    releaseId: manifest.release.id,
    // Publication signatures are lifecycle metadata, not calibrated teaching content.
    contentHash: createHash("sha256").update(JSON.stringify(manifest.v12 ? canonicalValue({ ...manifest, release: { id: manifest.release.id, publishNote: manifest.release.publishNote } }) : manifest)).digest("hex"),
    knowledgeVersion: version,
    diagnosticVersion: version,
    questionGraphVersion: version,
    caseBankVersion: version,
    rubricVersion: manifest.rubric.version,
    promptVersion: manifest.v12 ? `assessment-1.2:${createHash("sha256").update(assessmentV12Prompt).update(JSON.stringify(z.toJSONSchema(modelTurnAssessmentSchema))).update(teachingV12Prompt).update(teachingReviewPrompt).update(JSON.stringify(z.toJSONSchema(coachingDecisionSchema))).digest("hex")}` : `knowledge-orchestration-1:${createHash("sha256").update(tutorSystemPrompt).update(reportSystemPrompt).digest("hex")}`,
    workflowVersion: manifest.v12 ? "evidence-workflow-1.2.3-grounded-followup" : "runtime-activities-1",
    ...(manifest.v12 ? { schemaVersion: "1.2", pedagogyVersion: "1.2.1" } : {}),
    modelProvider: env.AI_PROVIDER,
    modelName: env.AI_PROVIDER === "mock" ? "deterministic-mock" : env.DEEPSEEK_MODEL,
  };
}

export function resolvePinnedManifest(versions: SessionVersions): KnowledgeManifest {
  const manifest = getActiveManifests().find((item) => item.release.id === versions.releaseId && createVersionSnapshot(item).contentHash === versions.contentHash);
  if (!manifest) throw new AppError("CONFLICT", "本会话使用的知识版本已变更或不可用，请保留历史记录并新建学习任务。", 409);
  const current = createVersionSnapshot(manifest);
  if (current.modelProvider !== versions.modelProvider || current.modelName !== versions.modelName || current.promptVersion !== versions.promptVersion || current.workflowVersion !== versions.workflowVersion) {
    throw new AppError("CONFLICT", "本会话的模型或运行规则版本已变更，请新建学习任务。", 409);
  }
  return manifest;
}

export async function resolveRuntimeManifest(versions: SessionVersions): Promise<KnowledgeManifest> {
  const bundled = getActiveManifests().find((m) => m.release.id === versions.releaseId && createVersionSnapshot(m).contentHash === versions.contentHash);
  if (bundled) return resolvePinnedManifest(versions);
  const manifest = (await getRuntimeManifests(true)).find((m) => m.release.id === versions.releaseId && createVersionSnapshot(m).contentHash === versions.contentHash);
  if (!manifest) throw new AppError("CONFLICT", "本会话的知识版本不可用，请基于新版重新开始。", 409);
  const current = createVersionSnapshot(manifest);
  if (current.promptVersion !== versions.promptVersion || current.workflowVersion !== versions.workflowVersion || current.modelProvider !== versions.modelProvider || current.modelName !== versions.modelName) throw new AppError("CONFLICT", "运行规则或模型已变化，请重新开始。", 409);
  return manifest;
}
