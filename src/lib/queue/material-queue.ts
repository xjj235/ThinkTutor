import "server-only";

import { Queue } from "bullmq";
import { prisma } from "../db";
import { AppError } from "../errors";
import { getRedis } from "../redis";

export const materialQueueName = "thinktutor-materials";
let queue: Queue | undefined;

function getQueue(): Queue | null {
  const connection = getRedis();
  if (!connection) return null;
  queue ??= new Queue(materialQueueName, { connection, prefix: "thinktutor", defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1_000 }, removeOnComplete: 100, removeOnFail: 500 } });
  return queue;
}

export async function enqueueMaterialProcessing(materialId: string): Promise<void> {
  const material = await prisma.material.update({
    where: { id: materialId },
    data: { status: "QUEUED", retryCount: { increment: 1 } },
    select: { retryCount: true },
  });
  const materialQueue = getQueue();
  if (!materialQueue) return;
  try {
    await materialQueue.add("MATERIAL_PROCESS", { materialId }, { jobId: `material-${materialId}-${material.retryCount}` });
  } catch {
    await prisma.material.updateMany({
      where: { id: materialId, status: "QUEUED", retryCount: material.retryCount },
      data: { status: "FAILED", failureCode: "QUEUE_UNAVAILABLE", failureMessage: "处理队列暂时不可用，请重试。" },
    });
    throw new AppError("QUEUE_UNAVAILABLE", "处理队列暂时不可用，请重试。", 503, true);
  }
}
