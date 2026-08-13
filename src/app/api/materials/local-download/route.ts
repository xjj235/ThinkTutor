import { createRequestId, handleRouteError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import { verifyLocalStorageSignature } from "@/lib/storage/local-provider";
import { z } from "zod";

export async function GET(request: Request) {
  const requestId = createRequestId(request);
  try {
    if (getServerEnv().STORAGE_PROVIDER !== "local") throw new AppError("NOT_FOUND", "接口不存在。", 404);
    const url = new URL(request.url);
    const objectKey = z.string().min(1).max(500).parse(url.searchParams.get("key"));
    const expires = z.coerce.number().int().parse(url.searchParams.get("expires"));
    const signature = z.string().min(20).max(200).parse(url.searchParams.get("signature"));
    verifyLocalStorageSignature(objectKey, expires, "GET", signature);
    const material = await prisma.material.findUnique({ where: { objectKey } });
    if (!material || material.status === "DELETED") throw new AppError("NOT_FOUND", "材料不存在。", 404);
    const data = await getStorageProvider().readObject(objectKey);
    return new Response(Uint8Array.from(data).buffer, { headers: { "content-type": material.mimeType, "content-length": String(data.byteLength), "cache-control": "private, no-store", "x-request-id": requestId, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(material.originalName)}` } });
  } catch (error) { return handleRouteError(error, requestId); }
}
