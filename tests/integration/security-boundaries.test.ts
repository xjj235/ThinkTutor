import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { apiOk } from "@/lib/api-response";
import type { AuthUser } from "@/lib/auth/session";
import { getClassroom, getCourse } from "@/lib/courses-service";
import { prisma } from "@/lib/db";
import { createMaterialUpload, getMaterial } from "@/lib/materials";
import { createTestUser } from "../factories";

function authUser(user: Awaited<ReturnType<typeof createTestUser>>): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

describe("user, course knowledge, and storage isolation", () => {
  async function cleanSecurityFixtures(): Promise<void> {
    await prisma.classroom.deleteMany();
    await prisma.course.deleteMany();
    await prisma.user.deleteMany();
  }

  beforeEach(cleanSecurityFixtures);

  afterAll(async () => {
    await cleanSecurityFixtures();
    await prisma.$disconnect();
  });

  it("returns a student only public course fields and published class assignments", async () => {
    const teacher = await createTestUser("security-teacher", "TEACHER");
    const student = await createTestUser("security-student");
    const peer = await createTestUser("security-peer");
    const course = await prisma.course.create({
      data: { ownerId: teacher.id, title: "安全课程", status: "PUBLISHED" },
    });
    const classroom = await prisma.classroom.create({
      data: { courseId: course.id, teacherId: teacher.id, name: "安全班级", joinCode: "SAFE2026" },
    });
    await prisma.enrollment.createMany({
      data: [student.id, peer.id].map((userId) => ({ classroomId: classroom.id, userId })),
    });
    await prisma.assignment.createMany({
      data: [
        { courseId: course.id, classroomId: classroom.id, createdById: teacher.id, title: "已发布任务", instructions: "学习", learnerLevel: "初学", status: "PUBLISHED" },
        { courseId: course.id, classroomId: classroom.id, createdById: teacher.id, title: "私密草稿", instructions: "内部", learnerLevel: "初学", status: "DRAFT" },
      ],
    });

    const studentCourse = await getCourse(authUser(student), course.id);
    const studentClassroom = await getClassroom(authUser(student), classroom.id);
    expect(studentCourse).not.toHaveProperty("ownerId");
    expect(studentClassroom.joinCode).toBeNull();
    expect(studentClassroom.enrollments).toEqual([]);
    expect(JSON.stringify(studentClassroom)).not.toContain(peer.email);
    expect(studentClassroom.assignments.map((assignment) => assignment.title)).toEqual(["已发布任务"]);
  });

  it("blocks another teacher from material metadata and exposes only an opaque upload capability", async () => {
    const owner = await createTestUser("material-owner", "TEACHER");
    const outsider = await createTestUser("material-outsider", "TEACHER");
    const course = await prisma.course.create({ data: { ownerId: owner.id, title: "私有知识库" } });
    const created = await createMaterialUpload(authUser(owner), {
      courseId: course.id,
      title: "私有材料",
      fileName: "private.txt",
      mimeType: "text/plain",
      byteSize: 12,
    });

    expect(created.material).not.toHaveProperty("objectKey");
    expect(created.material).not.toHaveProperty("uploadedById");
    expect(created.upload.url).not.toContain(owner.id);
    await expect(getMaterial(authUser(outsider), created.material.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const visible = await getMaterial(authUser(owner), created.material.id);
    expect(visible).not.toHaveProperty("objectKey");
    expect(visible).not.toHaveProperty("sha256");
    expect(visible).not.toHaveProperty("failureMessage");
  });

  it("marks authenticated API responses private and non-cacheable", () => {
    const response = apiOk({ value: "private" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });
});
