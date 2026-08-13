import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorageProvider, verifyLocalStorageSignature, writeLocalObject } from "@/lib/storage/local-provider";
import { validateMaterialFile } from "@/lib/materials";

const originalRoot = process.env.LOCAL_STORAGE_ROOT;
const originalSecret = process.env.STORAGE_SIGNING_SECRET;
let temporaryRoot = "";

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "thinktutor-storage-test-"));
  process.env.LOCAL_STORAGE_ROOT = temporaryRoot;
  process.env.STORAGE_SIGNING_SECRET = "unit-test-storage-signing-secret-over-32-characters";
});

afterAll(async () => {
  if (originalRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = originalRoot;
  if (originalSecret === undefined) delete process.env.STORAGE_SIGNING_SECRET;
  else process.env.STORAGE_SIGNING_SECRET = originalSecret;
  if (temporaryRoot.startsWith(tmpdir())) await rm(temporaryRoot, { recursive: true, force: true });
});

describe("local signed storage", () => {
  it("rejects forged MIME types, unsupported formats, and oversized files", () => {
    expect(() => validateMaterialFile("lesson.pdf", "text/plain", 10)).toThrow("MIME 类型不匹配");
    expect(() => validateMaterialFile("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 10)).toThrow("不支持 PPTX");
    expect(() => validateMaterialFile("lesson.txt", "text/plain", 21 * 1024 * 1024)).toThrow("超过上传大小限制");
  });

  it("rejects traversal and malformed object keys", async () => {
    const provider = new LocalStorageProvider();
    await expect(provider.createUploadUrl({ objectKey: "../secret.txt", contentType: "text/plain", byteSize: 1 })).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    await expect(provider.createUploadUrl({ objectKey: "materials/user/no-extension", contentType: "text/plain", byteSize: 1 })).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });

  it("signs, stores, verifies metadata, reads, and deletes an object", async () => {
    const provider = new LocalStorageProvider();
    const objectKey = "materials/test-user/material.txt";
    const data = new TextEncoder().encode("course material");
    const signed = await provider.createUploadUrl({ objectKey, contentType: "text/plain", byteSize: data.byteLength });
    const url = new URL(signed.url, "http://127.0.0.1:3000");
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    expect(() => verifyLocalStorageSignature(objectKey, expires, "PUT", signature)).not.toThrow();
    expect(() => verifyLocalStorageSignature(objectKey, expires, "GET", signature)).toThrow("签名无效");

    await writeLocalObject(objectKey, "text/plain", data);
    await expect(provider.confirmUpload({ objectKey, contentType: "application/pdf", byteSize: data.byteLength })).rejects.toMatchObject({ code: "STORAGE_ERROR" });
    expect(Array.from(await provider.readObject(objectKey))).toEqual(Array.from(data));
    await provider.deleteObject(objectKey);
    await expect(provider.headObject(objectKey)).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });
});
