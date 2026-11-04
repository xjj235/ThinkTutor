import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listAIUsage, listAIUsagePage, listAuditLogsPage, listMaterialJobsPage } from "@/lib/admin-service";
import { adminDateRange, aiUsageListSchema, auditLogListSchema, materialJobListSchema } from "@/lib/admin-list-query";
import { prisma } from "@/lib/db";
import { createTestUser } from "../factories";

const marker = `admin-list-${crypto.randomUUID()}`;
const timestamp = new Date("2035-01-01T04:00:00Z");
let userId: string;
let courseId: string;
async function cleanupRecords() {
  await prisma.aIUsage.deleteMany({ where: { requestId: { startsWith: marker } } });
  await prisma.auditLog.deleteMany({ where: { requestId: { startsWith: marker } } });
  if (courseId) await prisma.material.deleteMany({ where: { courseId } });
}

describe("administrator record filters and pagination", () => {
  beforeAll(async () => {
    userId = (await createTestUser(marker, "TEACHER")).id;
    courseId = (await prisma.course.create({ data: { ownerId: userId, title: marker } })).id;
  });
  beforeEach(cleanupRecords);
  afterAll(async () => {
    await cleanupRecords();
    await prisma.course.delete({ where: { id: courseId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("validates dates, enum filters and page limits before database queries", async () => {
    expect(aiUsageListSchema.parse({ status: "", operation: "", from: "", to: "" })).toMatchObject({ page: 1, limit: 20 });
    for (const input of [{ from: "2035-02-29" }, { from: "2035-01-02", to: "2035-01-01" }, { page: 0 }, { page: 10_001 }, { limit: 101 }, { status: "UNKNOWN" }, { query: "x".repeat(121) }]) {
      expect(aiUsageListSchema.safeParse(input).success).toBe(false);
    }
    expect(auditLogListSchema.safeParse({ action: "DELETE_EVERYTHING" }).success).toBe(false);
    expect(materialJobListSchema.safeParse({ status: "SUCCESS" }).success).toBe(false);
    await expect(listAIUsagePage({ page: 1, limit: 101 })).rejects.toThrow();
    expect(adminDateRange({ from: "2035-01-01", to: "2035-01-01" })).toEqual({
      gte: new Date("2034-12-31T16:00:00Z"), lt: new Date("2035-01-01T16:00:00Z"),
    });
  });

  it("retrieves records beyond the former 100 row limit with deterministic tie ordering and combined filters", async () => {
    await prisma.aIUsage.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      id: `${marker}-${String(index).padStart(3, "0")}`, requestId: `${marker}-${index}`, provider: "deepseek", model: marker,
      operation: "coach", status: "FAILED", errorCode: "AI_TIMEOUT", latencyMs: 45000, createdAt: timestamp,
    })) });
    await prisma.aIUsage.createMany({ data: [
      { requestId: `${marker}-other-status`, provider: "deepseek", model: marker, operation: "coach", status: "SUCCESS", latencyMs: 100, createdAt: timestamp },
      { requestId: `${marker}-other-operation`, provider: "deepseek", model: marker, operation: "report", status: "FAILED", latencyMs: 100, createdAt: timestamp },
      { requestId: `${marker}-next-day`, provider: "deepseek", model: marker, operation: "coach", status: "FAILED", latencyMs: 100, createdAt: new Date("2035-01-01T16:00:00Z") },
    ] });
    const query = aiUsageListSchema.parse({ query: marker.toUpperCase(), status: "FAILED", operation: "coach", from: "2035-01-01", to: "2035-01-01" });
    const pages = await Promise.all(Array.from({ length: 6 }, (_, index) => listAIUsagePage({ ...query, page: index + 1 })));
    expect(pages[0]).toMatchObject({ total: 105, totalPages: 6, pageSize: 20 });
    expect(pages[5].items).toHaveLength(5);
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(105);
    expect(ids).toEqual([...ids].sort().reverse());
    expect((await listAIUsagePage({ ...query, page: 1 })).items.map((item) => item.id)).toEqual(ids.slice(0, 20));
    expect(Array.isArray(await listAIUsage(2))).toBe(true); // Existing API callers retain their array response.
  });

  it("supports completed material history without widening the default work queue", async () => {
    await prisma.material.createMany({ data: Array.from({ length: 23 }, (_, index) => ({
      courseId, uploadedById: userId, title: `${marker} ${index}`, originalName: "lesson.txt", objectKey: `${marker}/${index}`,
      mimeType: "text/plain", kind: "TXT", byteSize: 1, status: index === 22 ? "READY" : "FAILED", updatedAt: timestamp,
    })) });
    const input = materialJobListSchema.parse({ query: marker, from: "2035-01-01", to: "2035-01-01" });
    const queue = await listMaterialJobsPage(input);
    expect(queue.total).toBe(22);
    expect(queue.items.every((item) => item.status === "FAILED")).toBe(true);
    expect((await listMaterialJobsPage({ ...input, page: 2 })).items).toHaveLength(2);
    const ready = await listMaterialJobsPage({ ...input, status: "READY" });
    expect(ready.total).toBe(1);
    expect(ready.items[0].title).toBe(`${marker} 22`);
    expect((await listMaterialJobsPage({ ...input, query: "nonexistent-" + marker })).total).toBe(0);
  });

  it("filters audit events by actor and action with inclusive Beijing date boundaries and minimal disclosure", async () => {
    const dates = ["2034-12-31T15:59:59.999Z", "2034-12-31T16:00:00Z", "2035-01-01T15:59:59.999Z", "2035-01-01T16:00:00Z"];
    await prisma.auditLog.createMany({ data: dates.map((createdAt, index) => ({
      actorId: userId, action: "COURSE_UPDATED", targetType: "Course", targetId: courseId, requestId: `${marker}-${index}`,
      createdAt: new Date(createdAt), metadata: { privateTestValue: "must-not-leave-service" }, ipHash: "private-ip-hash",
    })) });
    const input = auditLogListSchema.parse({ query: marker, action: "COURSE_UPDATED", from: "2035-01-01", to: "2035-01-01", limit: 1 });
    const first = await listAuditLogsPage(input);
    const second = await listAuditLogsPage({ ...input, page: 2 });
    expect(first.total).toBe(2);
    expect(first.items[0].requestId).toBe(`${marker}-2`);
    expect(second.items[0].requestId).toBe(`${marker}-1`);
    expect(first.items[0]).not.toHaveProperty("metadata");
    expect(first.items[0]).not.toHaveProperty("ipHash");
    expect((await listAuditLogsPage({ ...input, action: "AUTH_LOGOUT" })).items).toEqual([]);
  });
});
