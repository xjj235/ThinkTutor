import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import type { AuthUser } from "../auth/session";
import { assertTeacherOrAdmin, requireSessionAccess } from "../permissions";
import { buildV12Manifest } from "./v12-resources";
import { knowledgeManifestSchema, validateKnowledgeManifests } from "./schemas";
import { createVersionSnapshot } from "./releases";
import { claimReviewInputSchema, claimReviewRecordSchema, goldenSetSchema, releaseReviewInputSchema, sourceReviewsSchema } from "./review-schemas";
import { knowledgeRuntimeSchema } from "./runtime-schemas";
import { createHash } from "node:crypto";
import { getAIProvider } from "../ai";
import { getServerEnv } from "../env";
import { withAIRequestProtection } from "../request-limits";
import { evaluateGoldenSample } from "./golden-v12";
import { goldenValidationSchema } from "./review-schemas";
import { candidateReadiness, mergeCandidateSources } from "./release-candidate";

const json = (value: object): Prisma.InputJsonValue => structuredClone(value) as Prisma.InputJsonValue;
export async function reviewRelease(user: AuthUser, raw: unknown) {
  assertTeacherOrAdmin(user);
  const input = releaseReviewInputSchema.parse(raw);
  if (input.action === "CREATE") {
    const manifest = buildV12Manifest();
    return prisma.knowledgeRelease.upsert({ where: { id: manifest.release.id }, create: { id: manifest.release.id, ownerId: user.id, manifest: json(manifest), contentHash: createVersionSnapshot(manifest).contentHash, sourceReviews: [], goldenSet: [] }, update: {} });
  }
  const release = await prisma.knowledgeRelease.findUnique({ where: { id: "KR_SR_1_2" } });
  if (!release) throw new AppError("NOT_FOUND", "请先建立待审核版本。", 404);
  if (release.ownerId !== user.id && user.role !== "ADMIN") throw new AppError("FORBIDDEN", "只有版本负责人或管理员可以修改该版本。", 403);
  if (release.version !== input.version) throw new AppError("CONFLICT", "版本已变化，请刷新。", 409);
  if (input.action === "REFRESH_DRAFT") {
    if (release.status !== "DRAFT") throw new AppError("CONFLICT", "只能升级未冻结草稿。", 409);
    const upgraded = buildV12Manifest();
    const changed = await prisma.knowledgeRelease.updateMany({ where: { id: release.id, version: input.version, status: "DRAFT" }, data: { manifest: json(upgraded), contentHash: createVersionSnapshot(upgraded).contentHash, modelValidation: Prisma.DbNull, verifiedBy: null, verifiedAt: null, version: { increment: 1 } } });
    if (changed.count !== 1) throw new AppError("CONFLICT", "版本已变化，请刷新。", 409);
    return prisma.knowledgeRelease.findUniqueOrThrow({ where: { id: release.id } });
  }
  const manifest = knowledgeManifestSchema.parse(release.manifest);
  const sources = sourceReviewsSchema.parse(release.sourceReviews);
  const golden = goldenSetSchema.parse(release.goldenSet);
  const now = new Date();
  const updates: Prisma.KnowledgeReleaseUpdateManyMutationInput = { version: { increment: 1 } };
  const sampleHash = createHash("sha256").update(JSON.stringify(golden)).digest("hex");
  if (input.action === "ARCHIVE") updates.status = "ARCHIVED";
  else {
    if (["PUBLISHED", "ARCHIVED"].includes(release.status)) throw new AppError("CONFLICT", "已发布或归档版本不可编辑。", 409);
    if (["FROZEN", "REVIEWED"].includes(release.status) && ["SOURCE", "GOLDEN", "REMOVE_GOLDEN", "PEDAGOGY", "FREEZE"].includes(input.action)) throw new AppError("CONFLICT", "候选版本已冻结，请先解除冻结。", 409);
    if (input.action === "UNFREEZE") {
      updates.status = "DRAFT"; updates.modelValidation = Prisma.DbNull; updates.verifiedBy = null; updates.verifiedAt = null;
    } else if (input.action === "PEDAGOGY") {
      const rule = manifest.v12!.pedagogyRules.find((r) => r.id === input.ruleId);
      if (!rule) throw new AppError("VALIDATION_ERROR", "未知教学规则。", 400);
      Object.assign(rule, { sourceTitle: input.sourceTitle, sourceLocation: input.sourceLocation, basisType: input.basisType, sourceType: input.basisType === "theory" ? "theory" : input.basisType === "project_custom" ? "project" : "engineering", verifiedBy: user.id, verifiedAt: now.toISOString() });
      updates.manifest = json(manifest); updates.contentHash = createVersionSnapshot(manifest).contentHash; updates.modelValidation = Prisma.DbNull;
    } else if (input.action === "FREEZE") {
      const errors = candidateReadiness(manifest, sources, golden);
      if (errors.length) throw new AppError("CONFLICT", errors.join("；"), 409);
      const candidate = mergeCandidateSources(manifest, sources);
      const errorsAfterMerge = validateKnowledgeManifests([candidate]).errors;
      if (errorsAfterMerge.length) throw new AppError("CONFLICT", errorsAfterMerge.join("；"), 409);
      updates.manifest = json(candidate); updates.contentHash = createVersionSnapshot(candidate).contentHash;
      updates.status = "FROZEN"; updates.modelValidation = Prisma.DbNull;
    } else if (input.action === "VALIDATE_MODEL") {
      if (release.status !== "FROZEN" || candidateReadiness(manifest, sources, golden).length) throw new AppError("CONFLICT", "请先完成来源、规则及教师样例并冻结候选版本。", 409);
      const versions = createVersionSnapshot(manifest);
      if (versions.contentHash !== release.contentHash) throw new AppError("CONFLICT", "冻结内容哈希不一致。", 409);
      const results = [];
      for (const sample of golden) {
        const result = await evaluateGoldenSample(manifest, versions, sample, (request) => withAIRequestProtection(user.id, `golden:${release.id}`, () => getAIProvider().assessLearningTurn({ ...request, userId: user.id, requestId: crypto.randomUUID() })));
        results.push({ id: result.id, passed: result.passed, differences: result.differences });
      }
      updates.modelValidation = json(goldenValidationSchema.parse({ releaseId: release.id, contentHash: release.contentHash, sampleHash, modelProvider: versions.modelProvider, modelName: versions.modelName, promptVersion: versions.promptVersion, checkedAt: now.toISOString(), checkedBy: user.id, passed: results.every((r) => r.passed), results }));
    } else if (input.action === "SOURCE") {
      if (!manifest.knowledgeUnits.some((u) => u.id === input.source.unitId)) throw new AppError("VALIDATION_ERROR", "未知知识单元。", 400);
      updates.sourceReviews = json([...sources.filter((s) => s.unitId !== input.source.unitId), { ...input.source, verifiedBy: user.id, verifiedAt: now.toISOString() }]);
      updates.modelValidation = Prisma.DbNull;
      updates.status = "DRAFT"; updates.verifiedBy = null; updates.verifiedAt = null;
    } else if (input.action === "GOLDEN") {
      if (golden.length >= 50) throw new AppError("CONFLICT", "样例已达到50条上限，请先撤回不再使用的样例。", 409);
      if (golden.some((s) => s.studentAnswer.trim() === input.sample.studentAnswer.trim())) throw new AppError("CONFLICT", "该回答样例已存在。", 409);
      if (input.sample.caseId && !manifest.v12!.cases[input.sample.caseId]) throw new AppError("VALIDATION_ERROR", "未知案例。", 400);
      if (!manifest.v12!.unitRules[input.sample.targetId] || input.sample.expectedEvidenceIds.some((id) => !manifest.v12!.evidenceDefinitions[id]) || input.sample.expectedErrorIds.some((id) => !manifest.v12!.errors[id])) throw new AppError("VALIDATION_ERROR", "样例包含未知目标或证据 ID。", 400);
      if (input.sample.expectedGapIds.some((id) => !manifest.v12!.gaps[id]) || [...input.sample.resolvedClaimIds, ...input.sample.unresolvedClaimIds].some((id) => !manifest.v12!.gaps[id] && !manifest.v12!.errors[id]) || input.sample.resolvedClaimIds.some((id) => input.sample.unresolvedClaimIds.includes(id))) throw new AppError("VALIDATION_ERROR", "样例包含无效或矛盾的预期判断。", 400);
      updates.goldenSet = json([...golden, { ...input.sample, id: crypto.randomUUID(), verifiedBy: user.id, verifiedAt: now.toISOString() }]);
      updates.modelValidation = Prisma.DbNull;
      updates.status = "DRAFT"; updates.verifiedBy = null; updates.verifiedAt = null;
    } else if (input.action === "REMOVE_GOLDEN") {
      if (!golden.some((sample) => sample.id === input.sampleId)) throw new AppError("NOT_FOUND", "样例不存在。", 404);
      updates.goldenSet = json(golden.filter((sample) => sample.id !== input.sampleId));
      updates.modelValidation = Prisma.DbNull;
      updates.status = "DRAFT"; updates.verifiedBy = null; updates.verifiedAt = null;
    } else {
      if (!["FROZEN", "REVIEWED"].includes(release.status) || candidateReadiness(manifest, sources, golden).length) throw new AppError("CONFLICT", "审核需要完整且已冻结的候选版本。", 409);
      if (validateKnowledgeManifests([manifest]).errors.length) throw new AppError("CONFLICT", "资源校验失败。", 409);
      const validation = goldenValidationSchema.safeParse(release.modelValidation);
      const versions = createVersionSnapshot(manifest);
      if (versions.modelProvider !== "deepseek") throw new AppError("CONFLICT", "正式审核需要使用目标 DeepSeek 模型。", 409);
      if (!validation.success || !validation.data.passed || validation.data.releaseId !== release.id || validation.data.sampleHash !== sampleHash || validation.data.contentHash !== release.contentHash || versions.contentHash !== release.contentHash || validation.data.results.length !== golden.length || golden.some((s) => !validation.data.results.some((r) => r.id === s.id && r.passed)) || validation.data.modelProvider !== "deepseek" || validation.data.modelName !== getServerEnv().DEEPSEEK_MODEL || validation.data.promptVersion !== versions.promptVersion) throw new AppError("CONFLICT", "教师样例尚未通过当前真实模型校准。", 409);
      if (input.action === "REVIEW") { updates.status = "REVIEWED"; updates.verifiedBy = user.id; updates.verifiedAt = now; }
      else {
        if (release.status !== "REVIEWED" || !release.verifiedBy || !release.verifiedAt) throw new AppError("CONFLICT", "发布前必须完成教师审核。", 409);
        manifest.release.status = "published"; manifest.release.verifiedBy = release.verifiedBy; manifest.release.verifiedAt = release.verifiedAt.toISOString();
        if (createVersionSnapshot(manifest).contentHash !== release.contentHash) throw new AppError("CONFLICT", "发布对象与校准对象不一致。", 409);
        const validation = validateKnowledgeManifests([manifest]);
        if (validation.errors.length) throw new AppError("CONFLICT", validation.errors.join("; "), 409);
        updates.status = "PUBLISHED"; updates.manifest = json(manifest); updates.contentHash = createVersionSnapshot(manifest).contentHash;
      }
    }
  }
  const changed = await prisma.knowledgeRelease.updateMany({ where: { id: release.id, version: input.version }, data: updates });
  if (changed.count !== 1) throw new AppError("CONFLICT", "版本已变化，请刷新。", 409);
  return prisma.knowledgeRelease.findUniqueOrThrow({ where: { id: release.id } });
}

export async function reviewClaim(user: AuthUser, raw: unknown) {
  assertTeacherOrAdmin(user);
  const input = claimReviewInputSchema.parse(raw);
  await requireSessionAccess(user, input.sessionId);
  const session = await prisma.learningSession.findUniqueOrThrow({ where: { id: input.sessionId }, include: { messages: true } });
  const runtime = knowledgeRuntimeSchema.parse(session.knowledgeRuntime);
  const claim = runtime.v12?.misconceptionStates[input.claimId] ?? runtime.v12?.gapStates[input.claimId] ?? runtime.v12?.flagStates[input.claimId];
  if (!claim || !claim.evidenceRefs.length) throw new AppError("CONFLICT", "判断缺少可审核原文。", 409);
  if (claim.evidenceRefs.some((r) => !session.messages.some((m) => m.id === r.messageId && m.role === "USER" && m.content.slice(r.startOffset, r.endOffset) === r.extractedText))) throw new AppError("CONFLICT", "原文引用校验失败。", 409);
  const before = structuredClone(claim);
  claim.status = input.action === "CONFIRM" ? "CONFIRMED" : input.action === "REJECT" ? "RESOLVED" : "CANDIDATE";
  runtime.v12!.needsTeacherReview = input.action === "NEED_MORE_EVIDENCE" || [...Object.values(runtime.v12!.misconceptionStates), ...Object.values(runtime.v12!.gapStates), ...Object.values(runtime.v12!.flagStates)].some((c) => c.status === "CANDIDATE");
  await prisma.$transaction(async (tx) => {
    const changed = await tx.learningSession.updateMany({ where: { id: session.id, version: input.version }, data: { knowledgeRuntime: json(runtime), version: { increment: 1 } } });
    if (changed.count !== 1) throw new AppError("CONFLICT", "学生状态已变化，请刷新后审核。", 409);
    await tx.auditLog.create({ data: { actorId: user.id, action: "KNOWLEDGE_REVIEWED", targetType: "KnowledgeClaimReview", targetId: session.id, requestId: crypto.randomUUID(), metadata: json(claimReviewRecordSchema.parse({ type: "KNOWLEDGE_CLAIM_REVIEW", claimId: input.claimId, action: input.action, note: input.note, before, after: claim })) } });
  });
}
