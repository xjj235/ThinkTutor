import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const separator = process.argv.indexOf("--");
const commandValue = separator >= 0 ? process.argv[separator + 1] : undefined;
const commandArguments = separator >= 0 ? process.argv.slice(separator + 2) : [];

function requireCommand(value: string | undefined): string {
  if (!value) throw new Error("Usage: tsx scripts/with-test-postgres.ts -- <command> [...args]");
  return value;
}

const command = requireCommand(commandValue);

const port = Number(process.env.TEST_POSTGRES_PORT ?? "55432");
const user = "thinktutor_test";
const database = "thinktutor_test";
const shadowDatabase = "thinktutor_shadow";
const password = randomBytes(24).toString("base64url");
const databaseDir = resolve(`.embedded-postgres/${process.pid}`);
const workspace = resolve(".");

if (!databaseDir.startsWith(`${workspace}\\`) && !databaseDir.startsWith(`${workspace}/`)) {
  throw new Error("Embedded PostgreSQL data directory escaped the workspace.");
}

const postgres = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  authMethod: "scram-sha-256",
  persistent: false,
  onLog: (message) => {
    if (process.env.POSTGRES_VERBOSE === "true") process.stdout.write(`${message}\n`);
  },
  onError: (error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`),
});

async function stopPostgres(): Promise<void> {
  if (process.platform !== "win32") {
    await postgres.stop();
    return;
  }

  // embedded-postgres 18 waits forever when its unobserved taskkill child is
  // blocked by a managed Windows environment. Kill the owned child directly,
  // wait for its exit, then clear the package's private handle so its exit hook
  // cannot attempt to stop the same process a second time.
  const candidate: unknown = Reflect.get(postgres, "process");
  const child = candidate as ChildProcess | undefined;
  if (child && child.exitCode === null) {
    await new Promise<void>((resolveExit, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out while stopping embedded PostgreSQL.")), 15_000);
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolveExit();
      });
      if (!child.kill()) {
        clearTimeout(timeout);
        reject(new Error("Failed to stop embedded PostgreSQL."));
      }
    });
  }
  Reflect.set(postgres, "process", undefined);
  await rm(databaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function run(): Promise<number> {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);
  await postgres.createDatabase(shadowDatabase);

  const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
  const shadowDatabaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${shadowDatabase}`;
  const commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    AI_PROVIDER: "mock",
    AUTH_SECRET: "test-only-auth-secret-at-least-32-characters",
    STORAGE_SIGNING_SECRET: "test-only-storage-secret-at-least-32-characters",
    AI_PSEUDONYM_SECRET: "test-only-ai-pseudonym-secret-at-least-32-characters",
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadowDatabaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  };

  async function execute(executeCommand: string, executeArguments: string[]): Promise<number> {
    return await new Promise<number>((resolveExit, reject) => {
      const containsShellMetacharacters = [executeCommand, ...executeArguments].some((value) => /[&|<>^%!\r\n]/.test(value));
      if (containsShellMetacharacters) {
        reject(new Error("Test command contains unsupported shell metacharacters."));
        return;
      }
      const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : executeCommand;
      const args = process.platform === "win32"
        ? ["/d", "/s", "/c", ["call", executeCommand, ...executeArguments].join(" ")]
        : executeArguments;
      const child = spawn(executable, args, {
        cwd: workspace,
        env: commandEnv,
        shell: false,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code: number | null) => resolveExit(code ?? 1));
    });
  }

  const migrationExitCode = await execute("pnpm", ["exec", "prisma", "migrate", "deploy"]);
  if (migrationExitCode !== 0) return migrationExitCode;
  return execute(command, commandArguments);
}

let exitCode = 1;
try {
  exitCode = await run();
} finally {
  await stopPostgres().catch((error: unknown) => {
    process.stderr.write(`Failed to stop embedded PostgreSQL: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

process.exitCode = exitCode;
if (exitCode !== 0) throw new Error(`Test command failed with exit code ${exitCode}.`);
