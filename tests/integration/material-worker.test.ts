import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { writeLocalObject } from "@/lib/storage/local-provider";
import { LexicalCourseRetriever } from "@/lib/retrieval/lexical-retriever";
import { chunkMaterialText, processMaterial } from "@/worker/material-processor";
import { createTestUser } from "../factories";

const originalRoot = process.env.LOCAL_STORAGE_ROOT;
const originalSecret = process.env.STORAGE_SIGNING_SECRET;
let temporaryRoot = "";

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "thinktutor-worker-test-"));
  process.env.LOCAL_STORAGE_ROOT = temporaryRoot;
  process.env.STORAGE_SIGNING_SECRET = "integration-test-storage-secret-over-32-characters";
});

beforeEach(async () => {
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
  if (originalRoot === undefined) delete process.env.LOCAL_STORAGE_ROOT;
  else process.env.LOCAL_STORAGE_ROOT = originalRoot;
  if (originalSecret === undefined) delete process.env.STORAGE_SIGNING_SECRET;
  else process.env.STORAGE_SIGNING_SECRET = originalSecret;
  if (temporaryRoot.startsWith(tmpdir())) await rm(temporaryRoot, { recursive: true, force: true });
});

async function createTextMaterial(byteSizeOffset = 0, content = "系统性风险通过共同资产、杠杆与流动性渠道传播。\n\n证据需要说明冲击、传导渠道与系统后果之间的关系。") {
  const teacher = await createTestUser(`material-${crypto.randomUUID()}`, "TEACHER");
  const course = await prisma.course.create({ data: { ownerId: teacher.id, title: "材料测试课程" } });
  const objectKey = `materials/${teacher.id}/${crypto.randomUUID()}.txt`;
  const data = new TextEncoder().encode(content);
  await writeLocalObject(objectKey, "text/plain", data);
  const material = await prisma.material.create({
    data: { courseId: course.id, uploadedById: teacher.id, title: "风险材料", originalName: "risk.txt", objectKey, mimeType: "text/plain", kind: "TXT", byteSize: data.byteLength + byteSizeOffset, status: "UPLOADED" },
  });
  return material;
}

describe("material worker", () => {
  it("chunks deterministically and does not duplicate chunks when a completed job repeats", async () => {
    const material = await createTextMaterial();
    expect(chunkMaterialText("第一段。\n\n第二段。")).toEqual(chunkMaterialText("第一段。\n\n第二段。"));
    await processMaterial(material.id);
    const first = await prisma.material.findUniqueOrThrow({ where: { id: material.id }, include: { chunks: true } });
    expect(first.status).toBe("READY");
    expect(first.chunks.length).toBeGreaterThan(0);
    await processMaterial(material.id);
    expect(await prisma.materialChunk.count({ where: { materialId: material.id } })).toBe(first.chunks.length);
  });

  it("persists a retryable failure without leaving a material in PROCESSING", async () => {
    const material = await createTextMaterial(1);
    await expect(processMaterial(material.id)).rejects.toThrow("文件大小");
    await expect(prisma.material.findUniqueOrThrow({ where: { id: material.id } })).resolves.toMatchObject({ status: "FAILED", retryCount: 1, failureCode: "MATERIAL_PROCESSING_ERROR" });
  });

  it("retrieves only ready chunks from the requested course", async () => {
    const systemic = await createTextMaterial();
    const supplyChain = await createTextMaterial(0, "供应链风险会沿核心企业、应收账款和融资渠道传播。这个材料只属于另一门课程。");
    await processMaterial(systemic.id);
    await processMaterial(supplyChain.id);
    const retriever = new LexicalCourseRetriever();
    await expect(retriever.retrieve({ courseId: systemic.courseId, query: "系统性风险", limit: 5 })).resolves.toHaveLength(1);
    await expect(retriever.retrieve({ courseId: systemic.courseId, query: "供应链风险", limit: 5 })).resolves.toEqual([]);
  });
});
