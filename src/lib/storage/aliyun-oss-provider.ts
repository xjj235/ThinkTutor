import "server-only";

import Credential, { Config } from "@alicloud/credentials";
import OSS from "ali-oss";
import { z } from "zod";
import { getServerEnv } from "../env";
import { AppError } from "../errors";
import type { SignedUpload, StorageProvider, StoredObjectHead, UploadRequest } from "./types";

const ossHeadersSchema = z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())]));

async function createClient(): Promise<OSS> {
  const env = getServerEnv();
  let accessKeyId = env.OSS_ACCESS_KEY_ID;
  let accessKeySecret = env.OSS_ACCESS_KEY_SECRET;
  let stsToken = env.OSS_STS_TOKEN;

  if (env.OSS_ROLE_ARN) {
    if (!accessKeyId || !accessKeySecret) {
      throw new AppError("STORAGE_ERROR", "使用 OSS_ROLE_ARN 时必须提供用于 AssumeRole 的最小权限源凭据。ECS 实例角色无需设置 ARN。", 500);
    }
    const resolved = await new Credential(new Config({
      type: "ram_role_arn",
      accessKeyId,
      accessKeySecret,
      roleArn: env.OSS_ROLE_ARN,
      roleSessionName: "thinktutor-oss",
      roleSessionExpiration: 3_600,
    })).getCredential();
    accessKeyId = resolved.accessKeyId;
    accessKeySecret = resolved.accessKeySecret;
    stsToken = resolved.securityToken;
  } else if (!accessKeyId || !accessKeySecret) {
    const resolved = await new Credential(new Config({ type: "ecs_ram_role", disableIMDSv1: true })).getCredential();
    accessKeyId = resolved.accessKeyId;
    accessKeySecret = resolved.accessKeySecret;
    stsToken = resolved.securityToken;
  }
  if (!accessKeyId || !accessKeySecret || !env.OSS_REGION || !env.OSS_BUCKET) throw new AppError("STORAGE_ERROR", "OSS 凭据或区域配置不完整。", 500);
  return new OSS({
    region: env.OSS_REGION,
    bucket: env.OSS_BUCKET,
    endpoint: env.OSS_ENDPOINT,
    accessKeyId,
    accessKeySecret,
    stsToken,
    secure: true,
    authorizationV4: true,
  });
}

export class AliyunOSSProvider implements StorageProvider {
  async createUploadUrl(request: UploadRequest): Promise<SignedUpload> {
    const expires = 10 * 60;
    const client = await createClient();
    const url = await client.signatureUrlV4("PUT", expires, { headers: { "content-type": request.contentType } }, request.objectKey, ["content-type"]);
    return { url, method: "PUT", headers: { "content-type": request.contentType }, expiresAt: new Date(Date.now() + expires * 1_000).toISOString() };
  }

  async headObject(objectKey: string): Promise<StoredObjectHead> {
    try {
      const result = await (await createClient()).head(objectKey);
      const headers = ossHeadersSchema.parse(result.res.headers);
      const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : "application/octet-stream";
      const contentLength = Number(headers["content-length"] ?? result.res.size);
      const etag = typeof headers.etag === "string" ? headers.etag : undefined;
      return { objectKey, contentType, byteSize: contentLength, etag };
    } catch (error) {
      throw new AppError("STORAGE_ERROR", "无法读取 OSS 对象信息。", 502, true, error);
    }
  }

  async confirmUpload(request: UploadRequest): Promise<StoredObjectHead> {
    const head = await this.headObject(request.objectKey);
    if (head.byteSize !== request.byteSize || head.contentType !== request.contentType) throw new AppError("STORAGE_ERROR", "OSS 对象与上传申请不一致。", 400);
    return head;
  }

  async createDownloadUrl(objectKey: string) {
    const expires = 5 * 60;
    const url = await (await createClient()).signatureUrlV4("GET", expires, { headers: {} }, objectKey);
    return { url, expiresAt: new Date(Date.now() + expires * 1_000).toISOString() };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await (await createClient()).delete(objectKey);
  }

  async readObject(objectKey: string): Promise<Uint8Array> {
    const result = await (await createClient()).get(objectKey);
    return z.instanceof(Buffer).parse(result.content);
  }
}
