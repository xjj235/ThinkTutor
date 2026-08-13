import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    allowExitOnIdle: process.env.NODE_ENV === "test",
    connectionString: getServerEnv().DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: Number(process.env.DATABASE_POOL_MAX ?? "10"),
  });

  return new PrismaClient({
    adapter,
    errorFormat: "minimal",
    // Prisma error output can include query context. Application errors are
    // logged separately through the sanitized logger.
    log: process.env.NODE_ENV === "development" ? ["warn"] : [],
    transactionOptions: { maxWait: 5_000, timeout: 15_000 },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
