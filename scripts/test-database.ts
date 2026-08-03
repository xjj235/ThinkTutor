import { readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ALLOWED_TEST_DATABASES = new Set(["test.db", "e2e.db"]);

export function cleanTestDatabase(env: NodeJS.ProcessEnv) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:./")) {
    throw new Error("Test DATABASE_URL must use a relative SQLite file URL.");
  }

  const databaseName = databaseUrl.slice("file:./".length);
  if (
    basename(databaseName) !== databaseName ||
    !ALLOWED_TEST_DATABASES.has(databaseName)
  ) {
    throw new Error(`Refusing to reset unexpected database: ${databaseName}`);
  }

  const projectDirectory = resolve(process.cwd());
  const prismaDirectory = resolve(projectDirectory, "prisma");
  const databasePath = resolve(projectDirectory, databaseName);
  if (dirname(databasePath) !== projectDirectory) {
    throw new Error("Test database resolved outside the project directory.");
  }

  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }

  const migrationsDirectory = resolve(prismaDirectory, "migrations");
  const migrationFiles = readdirSync(migrationsDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(migrationsDirectory, entry.name, "migration.sql"))
    .sort();

  const database = new DatabaseSync(databasePath);
  try {
    for (const migrationFile of migrationFiles) {
      database.exec(readFileSync(migrationFile, "utf8"));
    }
  } finally {
    database.close();
  }
}
