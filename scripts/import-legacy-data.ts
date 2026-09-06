import "dotenv/config";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { z } from "zod";
import { reportDimensionsSchema, reportGapsSchema, strengthsSchema, nextStepsSchema } from "../src/lib/contracts";

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));
const exportSchema = z.object({
  format: z.literal("thinktutor-legacy-sqlite-v1"),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  data: z.object({
    LearningSession: z.array(rowSchema),
    Message: z.array(rowSchema),
    LearningReport: z.array(rowSchema),
  }),
});

function normalizeLegacyStrengths(value: unknown) {
  const current = strengthsSchema.safeParse(value);
  if (current.success) return current.data;
  return z.array(z.string().trim().min(1).max(180)).max(5).parse(value).map((title) => ({
    title,
    evidence: "旧版报告未独立保存优势证据，请结合原始对话复核。",
  }));
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stringValue(row: Record<string, string | number | null>, key: string): string {
  return z.string().parse(row[key]);
}

function optionalString(row: Record<string, string | number | null>, key: string): string | null {
  return z.string().nullable().parse(row[key] ?? null);
}

function dateValue(row: Record<string, string | number | null>, key: string): Date {
  return new Date(z.union([z.string(), z.number()]).parse(row[key]));
}

function jsonValue(value: string | number | null | undefined): Prisma.InputJsonValue | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return JSON.parse(value) as Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  const file = resolve(argument("--file") ?? "backups/production-upgrade-20260809-2305/legacy-export.json");
  const userId = z.string().min(10).max(40).parse(argument("--user-id"));
  const apply = process.argv.includes("--apply");
  const payload = exportSchema.parse(JSON.parse(await readFile(file, "utf8")));

  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", counts: payload.counts, userId })}\n`);
  if (!apply) return;

  const databaseUrl = z.string().startsWith("postgresql://").parse(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    if (!(await prisma.user.findUnique({ where: { id: userId } }))) throw new Error("目标 legacy 用户不存在。");
    await prisma.$transaction(async (tx) => {
      for (const row of payload.data.LearningSession) {
        await tx.learningSession.create({
          data: {
            id: stringValue(row, "id"),
            userId,
            course: optionalString(row, "course"),
            chapter: optionalString(row, "chapter"),
            topic: stringValue(row, "topic"),
            objective: stringValue(row, "objective"),
            learnerLevel: stringValue(row, "learnerLevel"),
            referenceText: optionalString(row, "referenceText"),
            phase: z.enum(["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "COMPLETED"]).parse(row.phase),
            socraticTurns: z.number().int().parse(row.socraticTurns),
            maxTurns: z.number().int().parse(row.maxTurns),
            learnerState: jsonValue(row.learnerState),
            parentSessionId: optionalString(row, "parentSessionId"),
            source: optionalString(row, "parentSessionId") ? "RETRY" : "SELF_DIRECTED",
            startedAt: dateValue(row, "createdAt"),
            createdAt: dateValue(row, "createdAt"),
            updatedAt: dateValue(row, "updatedAt"),
          },
        });
      }
      for (const row of payload.data.Message) {
        await tx.message.create({
          data: {
            id: stringValue(row, "id"),
            sessionId: stringValue(row, "sessionId"),
            role: z.enum(["USER", "ASSISTANT", "SYSTEM"]).parse(row.role),
            phase: z.enum(["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "COMPLETED"]).parse(row.phase),
            content: stringValue(row, "content"),
            questionType: z.enum(["CONCEPT_CLARIFICATION", "CAUSE_PROBE", "ASSUMPTION_TEST", "COUNTEREXAMPLE", "TRANSFER", "SCAFFOLDED_HINT"]).nullable().parse(row.questionType),
            clientRequestId: optionalString(row, "clientRequestId"),
            metadata: jsonValue(row.metadata),
            createdAt: dateValue(row, "createdAt"),
          },
        });
      }
      for (const row of payload.data.LearningReport) {
        const dimensions = reportDimensionsSchema.parse(jsonValue(row.dimensions));
        const strengths = normalizeLegacyStrengths(jsonValue(row.strengths));
        const gaps = reportGapsSchema.parse(jsonValue(row.gaps));
        const nextSteps = nextStepsSchema.parse(jsonValue(row.nextSteps));
        await tx.learningReport.create({
          data: {
            id: stringValue(row, "id"),
            sessionId: stringValue(row, "sessionId"),
            summary: stringValue(row, "summary"),
            overallScore: z.number().int().parse(row.overallScore),
            overallLevel: stringValue(row, "overallLevel"),
            disclaimer: stringValue(row, "disclaimer"),
            createdAt: dateValue(row, "createdAt"),
            dimensions: { create: Object.entries(dimensions).map(([key, value]) => ({ key: ({ conceptCompleteness: "CONCEPT_COMPLETENESS", logicCompleteness: "LOGIC_COMPLETENESS", expressionClarity: "EXPRESSION_CLARITY", exampleAbility: "EXAMPLE_ABILITY", transferAbility: "TRANSFER_ABILITY" } as const)[key as keyof typeof dimensions], ...value })) },
            strengths: { create: strengths.map((strength, position) => ({ ...strength, position })) },
            gaps: { create: gaps.map((gap) => ({ ...gap })) },
            nextSteps: { create: nextSteps.map((description, position) => ({ description, position })) },
          },
        });
      }
    }, { isolationLevel: "Serializable", timeout: 60_000 });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Legacy import failed"}\n`);
  process.exitCode = 1;
});
