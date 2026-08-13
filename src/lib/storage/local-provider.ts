import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getServerEnv } from "../env";
import { AppError } from "../errors";
import type { SignedUpload, StorageProvider, StoredObjectHead, UploadRequest } from "./types";

function rootPath(): string {
  return resolve(getServerEnv().LOCAL_STORAGE_ROOT);
}

function objectPath(objectKey: string): string {
  if (!/^[a-zA-Z0-9/_-]+\.[a-z0-9]+$/.test(objectKey)) throw new AppError("STORAGE_ERROR", "对象路径不合法。", 400);
  const root = rootPath();
  const target = resolve(root, objectKey);
  if (!target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) throw new AppError("STORAGE_ERROR", "对象路径越界。", 400);
  return target;
}

function signingKey(): string {
  const secret = getServerEnv().STORAGE_SIGNING_SECRET;
  if (!secret) throw new AppError("STORAGE_ERROR", "本地存储签名密钥未配置。", 500);
  return secret;
}

function signature(objectKey: string, expires: number, method: "PUT" | "GET"): string {
  return createHmac("sha256", signingKey()).update(`${method}\n${objectKey}\n${expires}`).digest("base64url");
}

export function verifyLocalStorageSignature(objectKey: string, expires: number, method: "PUT" | "GET", candidate: string): void {
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1_000)) throw new AppError("STORAGE_ERROR", "本地存储签名已过期。", 403);
  const expected = Buffer.from(signature(objectKey, expires, method));
  const actual = Buffer.from(candidate);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new AppError("STORAGE_ERROR", "本地存储签名无效。", 403);
}

export async function writeLocalObject(objectKey: string, contentType: string, data: Uint8Array): Promise<void> {
  const target = objectPath(objectKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data, { flag: "wx" });
  await writeFile(`${target}.meta.json`, JSON.stringify({ contentType, sha256: createHash("sha256").update(data).digest("hex") }), { flag: "wx" });
}

export class LocalStorageProvider implements StorageProvider {
  async createUploadUrl(request: UploadRequest): Promise<SignedUpload> {
    objectPath(request.objectKey);
    const expires = Math.floor(Date.now() / 1_000) + 10 * 60;
    return {
      url: `/api/materials/local-upload?key=${encodeURIComponent(request.objectKey)}&expires=${expires}&signature=${signature(request.objectKey, expires, "PUT")}`,
      method: "PUT",
      headers: { "content-type": request.contentType, "content-length": String(request.byteSize) },
      expiresAt: new Date(expires * 1_000).toISOString(),
    };
  }

  async headObject(objectKey: string): Promise<StoredObjectHead> {
    try {
      const target = objectPath(objectKey);
      const [file, metadataText] = await Promise.all([stat(target), readFile(`${target}.meta.json`, "utf8")]);
      const metadata = JSON.parse(metadataText) as { contentType?: unknown; sha256?: unknown };
      return { objectKey, byteSize: file.size, contentType: typeof metadata.contentType === "string" ? metadata.contentType : "application/octet-stream", etag: typeof metadata.sha256 === "string" ? metadata.sha256 : undefined };
    } catch (error) {
      throw new AppError("STORAGE_ERROR", "存储对象不存在或无法读取。", 404, false, error);
    }
  }

  async confirmUpload(request: UploadRequest): Promise<StoredObjectHead> {
    const head = await this.headObject(request.objectKey);
    if (head.byteSize !== request.byteSize || head.contentType !== request.contentType) throw new AppError("STORAGE_ERROR", "上传对象的大小或类型与申请不一致。", 400);
    return head;
  }

  async createDownloadUrl(objectKey: string) {
    const expires = Math.floor(Date.now() / 1_000) + 5 * 60;
    return { url: `/api/materials/local-download?key=${encodeURIComponent(objectKey)}&expires=${expires}&signature=${signature(objectKey, expires, "GET")}`, expiresAt: new Date(expires * 1_000).toISOString() };
  }

  async deleteObject(objectKey: string): Promise<void> {
    const target = objectPath(objectKey);
    await Promise.all([rm(target, { force: true }), rm(`${target}.meta.json`, { force: true })]);
  }

  async readObject(objectKey: string): Promise<Uint8Array> {
    return readFile(objectPath(objectKey));
  }
}
