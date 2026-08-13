import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";
import { z } from "zod";

const seedEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]).default("development"),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  DEV_SEED_PASSWORD: z.string().min(10).max(128),
});

const env = seedEnvSchema.parse(process.env);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

async function main(): Promise<void> {
  const passwordHash = await hash(env.DEV_SEED_PASSWORD, { type: 2, memoryCost: 19_456, timeCost: 3, parallelism: 1 });
  const teacher = await prisma.user.upsert({
    where: { email: "teacher@example.test" },
    update: { name: "测试教师", passwordHash, role: "TEACHER", status: "ACTIVE" },
    create: { email: "teacher@example.test", name: "测试教师", passwordHash, role: "TEACHER" },
  });
  const student = await prisma.user.upsert({
    where: { email: "student@example.test" },
    update: { name: "测试学生", passwordHash, role: "STUDENT", status: "ACTIVE" },
    create: { email: "student@example.test", name: "测试学生", passwordHash, role: "STUDENT" },
  });
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.test" },
    update: { name: "测试管理员", passwordHash, role: "ADMIN", status: "ACTIVE" },
    create: { email: "admin@example.test", name: "测试管理员", passwordHash, role: "ADMIN" },
  });

  const course = await prisma.course.upsert({
    where: { id: "seed_course_finance" },
    update: { ownerId: teacher.id },
    create: {
      id: "seed_course_finance",
      ownerId: teacher.id,
      title: "金融系统与风险",
      description: "用于开发环境验证完整教学闭环的示例课程。",
      audience: "本科入门学习者",
      subject: "金融学",
      status: "PUBLISHED",
    },
  });
  const chapter = await prisma.chapter.upsert({
    where: { id: "seed_chapter_systemic_risk" },
    update: { courseId: course.id },
    create: { id: "seed_chapter_systemic_risk", courseId: course.id, title: "系统性风险", description: "理解风险如何在机构之间传播。", sortOrder: 1 },
  });
  const goal = await prisma.learningGoal.upsert({
    where: { id: "seed_goal_transmission" },
    update: { courseId: course.id, chapterId: chapter.id },
    create: {
      id: "seed_goal_transmission",
      courseId: course.id,
      chapterId: chapter.id,
      title: "解释风险传播路径",
      objective: "能够用条件、传播渠道和系统后果解释系统性风险。",
      description: "以自己的语言解释至少一种风险传播机制。",
      expectedLevel: "发展中",
      sortOrder: 1,
    },
  });
  const classroom = await prisma.classroom.upsert({
    where: { id: "seed_class_finance_1" },
    update: { teacherId: teacher.id, courseId: course.id },
    create: { id: "seed_class_finance_1", courseId: course.id, teacherId: teacher.id, name: "金融学示例班", description: "开发环境示例班级", joinCode: "SEED2026" },
  });
  await prisma.enrollment.upsert({
    where: { classroomId_userId: { classroomId: classroom.id, userId: student.id } },
    update: { status: "ACTIVE" },
    create: { classroomId: classroom.id, userId: student.id },
  });
  const assignment = await prisma.assignment.upsert({
    where: { id: "seed_assignment_systemic_risk" },
    update: { createdById: teacher.id },
    create: {
      id: "seed_assignment_systemic_risk",
      courseId: course.id,
      classroomId: classroom.id,
      chapterId: chapter.id,
      learningGoalId: goal.id,
      createdById: teacher.id,
      title: "系统性风险形成机制",
      description: "通过追问和费曼讲解理解系统性风险。",
      instructions: "解释单个机构风险如何通过关联渠道演变为系统性风险。",
      learnerLevel: "本科入门",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  await prisma.assignmentStudent.upsert({
    where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id } },
    update: {},
    create: { assignmentId: assignment.id, studentId: student.id },
  });

  process.stdout.write(`${JSON.stringify({ teacher: teacher.email, student: student.email, admin: admin.email, courseId: course.id, assignmentId: assignment.id })}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Seed failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
