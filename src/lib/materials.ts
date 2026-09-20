import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthUser } from "./auth/session";
import { prisma } from "./db";
import { entityIdSchema } from "./domain-schemas";
import { getServerEnv } from "./env";
import { AppError } from "./errors";
import { requireOwnedCourse } from "./permissions";
import { enqueueMaterialProcessing } from "./queue/material-queue";
import { getStorageProvider } from "./storage";

const allowedFiles = {
  pdf: { mimeType: "application/pdf", kind: "PDF" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "DOCX" },
  txt: { mimeType: "text/plain", kind: "TXT" },
  md: { mimeType: "text/markdown", kind: "MARKDOWN" },
} as const;

const materialDtoSelect = {
  id: true,
  courseId: true,
  chapterId: true,
  title: true,
  originalName: true,
  mimeType: true,
  kind: true,
  byteSize: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const uploadUrlSchema = z
  .object({
    courseId: entityIdSchema,
    chapterId: entityIdSchema.optional(),
    title: z.string().trim().min(1).max(160),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(150),
    byteSize: z.number().int().positive(),
  })
  .strict();

export const completeUploadSchema = z.object({ materialId: entityIdSchema }).strict();

function requireMaterialProcessingAvailable(): void {
  if (getServerEnv().DEPLOYMENT_ENV === "competition") {
    throw new AppError("MATERIAL_PROCESSING_UNAVAILABLE", "比赛体验环境暂不支持文件上传与处理；已有材料仍可查看。", 503);
  }
}

export function validateMaterialFile(fileName: string, mimeType: string, byteSize: number) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !(extension in allowedFiles)) {
    if (extension === "pptx") throw new AppError("VALIDATION_ERROR", "当前不支持 PPTX，请导出为 PDF 后上传。", 400);
    throw new AppError("VALIDATION_ERROR", "仅支持 PDF、DOCX、TXT 和 MD。", 400);
  }
  const spec = allowedFiles[extension as keyof typeof allowedFiles];
  if (spec.mimeType !== mimeType) throw new AppError("VALIDATION_ERROR", "文件扩展名与 MIME 类型不匹配。", 400);
  const maximumBytes = Math.min(getServerEnv().MATERIAL_MAX_BYTES, getServerEnv().MAX_UPLOAD_MB * 1024 * 1024);
  if (byteSize > maximumBytes) throw new AppError("VALIDATION_ERROR", "文件超过上传大小限制。", 400);
  return { extension, ...spec };
}

export async function createMaterialUpload(user: AuthUser, input: z.infer<typeof uploadUrlSchema>) {
  await requireOwnedCourse(user, input.courseId);
  requireMaterialProcessingAvailable();
  if (input.chapterId) {
    const chapter = await prisma.chapter.findUnique({ where: { id: input.chapterId }, select: { courseId: true } });
    if (!chapter || chapter.courseId !== input.courseId) throw new AppError("VALIDATION_ERROR", "章节与课程不匹配。", 400);
  }
  const file = validateMaterialFile(input.fileName, input.mimeType, input.byteSize);
  const objectKey = `materials/${randomUUID()}.${file.extension}`;
  const material = await prisma.material.create({
    data: {
      courseId: input.courseId,
      chapterId: input.chapterId,
      uploadedById: user.id,
      title: input.title,
      originalName: input.fileName,
      objectKey,
      mimeType: file.mimeType,
      kind: file.kind,
      byteSize: input.byteSize,
    },
  });
  const upload = await getStorageProvider().createUploadUrl({ objectKey, contentType: file.mimeType, byteSize: input.byteSize });
  return {
    material: {
      id: material.id,
      courseId: material.courseId,
      chapterId: material.chapterId,
      title: material.title,
      originalName: material.originalName,
      mimeType: material.mimeType,
      kind: material.kind,
      byteSize: material.byteSize,
      status: material.status,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
    },
    upload,
  };
}

export async function completeMaterialUpload(user: AuthUser, materialId: string, requestId: string) {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw new AppError("NOT_FOUND", "课程材料不存在。", 404);
  await requireOwnedCourse(user, material.courseId);
  requireMaterialProcessingAvailable();
  if (["UPLOADED", "QUEUED", "PROCESSING", "READY"].includes(material.status)) {
    return prisma.material.findUniqueOrThrow({ where: { id: material.id }, select: materialDtoSelect });
  }
  if (material.status === "FAILED") {
    const claimed = await prisma.material.updateMany({
      where: { id: material.id, status: "FAILED" },
      data: { status: "UPLOADED", failureCode: null, failureMessage: null },
    });
    if (claimed.count === 1) await enqueueMaterialProcessing(material.id);
    return prisma.material.findUniqueOrThrow({ where: { id: material.id }, select: materialDtoSelect });
  }
  if (material.status !== "PENDING_UPLOAD") throw new AppError("CONFLICT", "该材料当前不能完成上传确认。", 409);
  const head = await getStorageProvider().confirmUpload({ objectKey: material.objectKey, contentType: material.mimeType, byteSize: material.byteSize });
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.material.updateMany({
      where: { id: material.id, status: "PENDING_UPLOAD" },
      data: { status: "UPLOADED", sha256: head.etag },
    });
    if (claimed.count === 1) {
      await tx.auditLog.create({ data: { actorId: user.id, action: "MATERIAL_UPLOADED", targetType: "Material", targetId: material.id, requestId, metadata: { kind: material.kind, byteSize: material.byteSize } } });
    }
    return claimed.count === 1;
  });
  if (updated) await enqueueMaterialProcessing(material.id);
  return prisma.material.findUniqueOrThrow({ where: { id: material.id }, select: materialDtoSelect });
}

export async function getMaterial(user: AuthUser, materialId: string) {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { ...materialDtoSelect, _count: { select: { chunks: true } } },
  });
  if (!material) throw new AppError("NOT_FOUND", "课程材料不存在。", 404);
  await requireOwnedCourse(user, material.courseId);
  return material;
}

export async function reprocessMaterial(user: AuthUser, materialId: string) {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw new AppError("NOT_FOUND", "课程材料不存在。", 404);
  await requireOwnedCourse(user, material.courseId);
  requireMaterialProcessingAvailable();
  if (!(["FAILED", "READY"] as const).includes(material.status as "FAILED" | "READY")) throw new AppError("CONFLICT", "该材料当前不能重新处理。", 409);
  const claimed = await prisma.material.updateMany({ where: { id: materialId, status: material.status }, data: { status: "UPLOADED", failureCode: null, failureMessage: null } });
  if (claimed.count !== 1) throw new AppError("CONFLICT", "材料状态已变化，请刷新后重试。", 409);
  await enqueueMaterialProcessing(materialId);
  return { queued: true };
}

export async function deleteMaterial(user: AuthUser, materialId: string, requestId: string): Promise<void> {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw new AppError("NOT_FOUND", "课程材料不存在。", 404);
  await requireOwnedCourse(user, material.courseId);
  await getStorageProvider().deleteObject(material.objectKey);
  await prisma.$transaction(async (tx) => {
    await tx.material.update({ where: { id: materialId }, data: { status: "DELETED", deletedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "MATERIAL_DELETED", targetType: "Material", targetId: materialId, requestId } });
  });
}
