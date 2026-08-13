import "dotenv/config";

import { z } from "zod";
import { prisma } from "../src/lib/db";
import { processMaterial } from "../src/worker/material-processor";

const materialId = z.string().min(10).max(40).parse(process.argv[2]);
processMaterial(materialId)
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Material processing failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
