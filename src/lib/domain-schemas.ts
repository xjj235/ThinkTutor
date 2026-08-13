import { z } from "zod";

export const entityIdSchema = z.string().trim().min(10).max(40);

export const courseInputSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2_000).optional(),
    audience: z.string().trim().max(200).optional(),
    subject: z.string().trim().max(100).optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  })
  .strict();

export const coursePatchSchema = courseInputSchema.partial().refine((value) => Object.keys(value).length > 0);

export const chapterInputSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2_000).optional(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();

export const chapterPatchSchema = chapterInputSchema.partial().refine((value) => Object.keys(value).length > 0);

export const goalInputSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    objective: z.string().trim().min(10).max(2_000),
    description: z.string().trim().max(2_000).optional(),
    expectedLevel: z.string().trim().max(100).optional(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();

export const goalPatchSchema = goalInputSchema.partial().refine((value) => Object.keys(value).length > 0);

export const classroomInputSchema = z
  .object({
    courseId: entityIdSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1_000).optional(),
  })
  .strict();

export const joinClassroomSchema = z.object({ joinCode: z.string().trim().min(6).max(20) }).strict();

const assignmentObjectSchema = z.object({
    classroomId: entityIdSchema,
    courseId: entityIdSchema,
    chapterId: entityIdSchema.optional(),
    learningGoalId: entityIdSchema.optional(),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2_000).optional(),
    instructions: z.string().trim().min(10).max(4_000),
    learnerLevel: z.string().trim().min(1).max(100),
    openAt: z.coerce.date().optional(),
    dueAt: z.coerce.date().optional(),
    maxAttempts: z.number().int().min(1).max(20).default(1),
  }).strict();

export const assignmentInputSchema = assignmentObjectSchema
  .refine((value) => !value.openAt || !value.dueAt || value.openAt < value.dueAt, {
    path: ["dueAt"],
    message: "截止时间必须晚于开放时间。",
  });

export const assignmentPatchSchema = assignmentObjectSchema.partial()
  .refine((value) => Object.keys(value).length > 0, { message: "至少提供一个可更新字段。" })
  .refine((value) => !value.openAt || !value.dueAt || value.openAt < value.dueAt, { path: ["dueAt"], message: "截止时间必须晚于开放时间。" });

export const paginationSchema = z.object({
  cursor: entityIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
