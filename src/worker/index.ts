import "dotenv/config";

import { Worker } from "bullmq";
import { z } from "zod";
import { materialQueueName } from "../lib/queue/material-queue";
import { getRedis } from "../lib/redis";
import { logger, safeErrorForLog } from "../lib/logger";
import { processMaterial } from "./material-processor";

const connection = getRedis();
if (!connection) throw new Error("Worker requires REDIS_URL.");
const redisConnection = connection;

const materialJobSchema = z.object({ materialId: z.string().min(10).max(40) }).strict();
const worker = new Worker(
  materialQueueName,
  async (job) => processMaterial(materialJobSchema.parse(job.data).materialId),
  { connection: redisConnection, prefix: "thinktutor", concurrency: Number(process.env.MATERIAL_WORKER_CONCURRENCY ?? "2") },
);

worker.on("completed", (job) => logger.info({ jobId: job.id }, "Material job completed"));
worker.on("failed", (job, error) => logger.error({ jobId: job?.id, ...safeErrorForLog(error) }, "Material job failed"));

async function shutdown(): Promise<void> {
  await worker.close();
  await redisConnection.quit();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
