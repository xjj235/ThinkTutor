import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.bigint(), z.null()]));

const tableNames = ["LearningSession", "Message", "LearningReport"] as const;

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeRow(row: unknown): Record<string, string | number | null> {
  const parsed = rowSchema.parse(row);
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );
}

async function main(): Promise<void> {
  const source = resolve(argument("--source", "dev.db"));
  const output = resolve(
    argument("--output", "backups/production-upgrade-20260809-2305/legacy-export.json"),
  );

  if (!existsSync(source)) {
    throw new Error(`Legacy SQLite database not found: ${source}`);
  }

  const database = new DatabaseSync(source, { readOnly: true });
  try {
    const availableTables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => z.object({ name: z.string() }).parse(row).name),
    );

    const data = Object.fromEntries(
      tableNames.map((table) => {
        if (!availableTables.has(table)) return [table, []];
        const rows = database.prepare(`SELECT * FROM \"${table}\"`).all().map(normalizeRow);
        return [table, rows];
      }),
    );

    const payload = {
      format: "thinktutor-legacy-sqlite-v1",
      exportedAt: new Date().toISOString(),
      sourceSha256: createHash("sha256").update(await readFile(source)).digest("hex"),
      counts: Object.fromEntries(tableNames.map((table) => [table, data[table].length])),
      data,
    };

    await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify({ output, counts: payload.counts })}\n`);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown export error"}\n`);
  process.exitCode = 1;
});
