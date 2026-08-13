import { apiOk, createRequestId, handleRouteError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { verifyLocalStorageSignature, writeLocalObject } from "@/lib/storage/local-provider";
import { z } from "zod";

export async function PUT(request: Request) {
  const requestId = createRequestId(request);
  try {
    if (getServerEnv().STORAGE_PROVIDER !== "local") throw new AppError("NOT_FOUND", "接口不存在。", 404);
    const url = new URL(request.url);
    const objectKey = z.string().min(1).max(500).parse(url.searchParams.get("key"));
    const expires = z.coerce.number().int().parse(url.searchParams.get("expires"));
    const signature = z.string().min(20).max(200).parse(url.searchParams.get("signature"));
    verifyLocalStorageSignature(objectKey, expires, "PUT", signature);
    const material = await prisma.material.findUnique({ where: { objectKey } });
    if (!material || material.status !== "PENDING_UPLOAD") throw new AppError("NOT_FOUND", "上传申请不存在。", 404);
    if (request.headers.get("content-type") !== material.mimeType) throw new AppError("VALIDATION_ERROR", "上传 MIME 类型不一致。", 400);
    const declaredLength = Number(request.headers.get("content-length"));
    if (!Number.isInteger(declaredLength) || declaredLength !== material.byteSize) throw new AppError("VALIDATION_ERROR", "上传大小不一致。", 400);
    const data = new Uint8Array(await request.arrayBuffer());
    if (data.byteLength !== material.byteSize || data.byteLength > getServerEnv().MATERIAL_MAX_BYTES) throw new AppError("VALIDATION_ERROR", "实际文件大小不一致。", 400);
    await writeLocalObject(objectKey, material.mimeType, data);
    return apiOk({ uploaded: true }, 200, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
