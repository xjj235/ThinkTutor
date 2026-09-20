import type { MaterialStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { completeMaterialUpload, createMaterialUpload, getMaterial, reprocessMaterial } from "@/lib/materials";
import { createTestUser } from "../factories";

const unavailableError = {
  code: "MATERIAL_PROCESSING_UNAVAILABLE",
  status: 503,
  message: "比赛体验环境暂不支持文件上传与处理；已有材料仍可查看。",
};

async function cleanFixtures(): Promise<void> {
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
}

async function createCourseFixture() {
  const owner = await createTestUser("competition-material-owner", "TEACHER");
  const course = await prisma.course.create({ data: { ownerId: owner.id, title: "比赛材料课程" } });
  return { owner, course };
}

async function createMaterialFixture(status: MaterialStatus) {
  const { owner, course } = await createCourseFixture();
  const material = await prisma.material.create({
    data: {
      courseId: course.id,
      uploadedById: owner.id,
      title: "已有课程资料",
      originalName: "course.txt",
      objectKey: `materials/${crypto.randomUUID()}.txt`,
      mimeType: "text/plain",
      kind: "TXT",
      byteSize: 12,
      status,
      ...(status === "FAILED" ? { failureCode: "PRIOR_FAILURE", failureMessage: "原有处理错误", retryCount: 1 } : {}),
    },
  });
  return { owner, course, material };
}

function uploadInput(courseId: string) {
  return { courseId, title: "新课程资料", fileName: "course.txt", mimeType: "text/plain", byteSize: 12 };
}

describe("competition material boundaries", () => {
  beforeEach(async () => {
    await cleanFixtures();
    vi.stubEnv("DEPLOYMENT_ENV", "competition");
    vi.stubEnv("LOCAL_PREVIEW", "false");
    vi.stubEnv("APP_URL", "https://competition.example.test");
    vi.stubEnv("AUTH_COOKIE_SECURE", "true");
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.stubEnv("AUTH_SECRET", "competition-test-auth-secret-at-least-32-characters");
    vi.stubEnv("AI_PSEUDONYM_SECRET", "competition-test-pseudonym-secret-at-least-32-characters");
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_SIGNING_SECRET", "competition-test-storage-secret-at-least-32-characters");
  });

  afterEach(() => vi.unstubAllEnvs());

  afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  it("rejects an authorized upload before inserting a material", async () => {
    const { owner, course } = await createCourseFixture();
    const auditCount = await prisma.auditLog.count();

    await expect(createMaterialUpload(owner, uploadInput(course.id))).rejects.toMatchObject(unavailableError);

    expect(await prisma.material.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditCount);
  });

  it.each(["PENDING_UPLOAD", "FAILED", "UPLOADED", "QUEUED", "PROCESSING", "READY"] as const)(
    "rejects upload completion for %s without changing the material or audit trail",
    async (status) => {
      const { owner, material } = await createMaterialFixture(status);
      const auditCount = await prisma.auditLog.count();

      await expect(completeMaterialUpload(owner, material.id, "competition-complete-test")).rejects.toMatchObject(unavailableError);

      expect(await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).toEqual(material);
      expect(await prisma.auditLog.count()).toBe(auditCount);
    },
  );

  it.each(["FAILED", "READY"] as const)("rejects reprocessing a %s material without changing its state", async (status) => {
    const { owner, material } = await createMaterialFixture(status);
    const auditCount = await prisma.auditLog.count();

    await expect(reprocessMaterial(owner, material.id)).rejects.toMatchObject(unavailableError);

    expect(await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).toEqual(material);
    expect(await prisma.auditLog.count()).toBe(auditCount);
  });

  it("checks course ownership before reporting the competition limitation", async () => {
    const { course, material } = await createMaterialFixture("FAILED");
    const outsider = await createTestUser("competition-material-outsider", "TEACHER");
    const forbidden = { code: "FORBIDDEN", status: 403 };
    const auditCount = await prisma.auditLog.count();

    await expect(createMaterialUpload(outsider, uploadInput(course.id))).rejects.toMatchObject(forbidden);
    await expect(completeMaterialUpload(outsider, material.id, "competition-forbidden-test")).rejects.toMatchObject(forbidden);
    await expect(reprocessMaterial(outsider, material.id)).rejects.toMatchObject(forbidden);

    expect(await prisma.material.count({ where: { courseId: course.id } })).toBe(1);
    expect(await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).toEqual(material);
    expect(await prisma.auditLog.count()).toBe(auditCount);
  });

  it("keeps existing materials readable to their owner", async () => {
    const { owner, material } = await createMaterialFixture("READY");

    await expect(getMaterial(owner, material.id)).resolves.toMatchObject({ id: material.id, status: "READY", title: material.title });
  });

  it("preserves uploads in the development environment", async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "development");
    const { owner, course } = await createCourseFixture();

    const result = await createMaterialUpload(owner, uploadInput(course.id));

    expect(result.material.status).toBe("PENDING_UPLOAD");
    expect(await prisma.material.count({ where: { courseId: course.id } })).toBe(1);
    expect(result.upload.url).toBeTruthy();
  });
});
