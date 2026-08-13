import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  createSessionInputSchema,
  learningPhaseSchema,
  messageRoleSchema,
  messageMetadataSchema,
  questionTypeSchema,
  sessionIdSchema,
  textLimits,
} from "./contracts";
import { prisma } from "./db";
import { sessionRelations } from "./serializers";

export const saveMessageInputSchema = z
  .object({
    sessionId: sessionIdSchema,
    role: messageRoleSchema,
    phase: learningPhaseSchema,
    content: z.string().trim().min(1).max(textLimits.referenceText),
    questionType: questionTypeSchema.nullish(),
    clientRequestId: z
      .string()
      .trim()
      .min(8)
      .max(textLimits.clientRequestId)
      .nullish(),
    metadata: messageMetadataSchema.nullish(),
  })
  .strict();

export type SaveMessageInput = z.infer<typeof saveMessageInputSchema>;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function findMessageByClientRequestId(clientRequestId: string) {
  return prisma.message.findUnique({
    where: { clientRequestId },
  });
}

export async function createSession(
  input: z.input<typeof createSessionInputSchema> & { userId: string },
) {
  const { userId, ...taskInput } = input;
  const data = createSessionInputSchema.parse(taskInput);

  return prisma.learningSession.create({
    data: { ...data, userId },
    include: sessionRelations,
  });
}

export async function readSession(id: string) {
  const sessionId = sessionIdSchema.parse(id);

  return prisma.learningSession.findUnique({
    where: { id: sessionId },
    include: sessionRelations,
  });
}

export async function saveMessage(
  input: SaveMessageInput,
): Promise<{ message: Awaited<ReturnType<typeof prisma.message.create>>; duplicate: boolean }> {
  const data = saveMessageInputSchema.parse(input);

  if (data.clientRequestId) {
    const existing = await findMessageByClientRequestId(data.clientRequestId);
    if (existing) {
      if (existing.sessionId !== data.sessionId) throw new Error("clientRequestId is globally unique.");
      return { message: existing, duplicate: true };
    }
  }

  try {
    const message = await prisma.message.create({
      data: {
        sessionId: data.sessionId,
        role: data.role,
        phase: data.phase,
        content: data.content,
        questionType: data.questionType ?? null,
        clientRequestId: data.clientRequestId ?? null,
        metadata: data.metadata ?? undefined,
      },
    });
    return { message, duplicate: false };
  } catch (error) {
    if (!data.clientRequestId || !isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await findMessageByClientRequestId(data.clientRequestId);
    if (!existing) {
      throw error;
    }
    if (existing.sessionId !== data.sessionId) throw error;
    return { message: existing, duplicate: true };
  }
}
