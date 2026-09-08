import { access, unlink } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { config as loadEnv } from "dotenv";
import { resolvePreviewAI } from "./preview-ai-config";

const workspace = resolve(".");
loadEnv({ path: [resolve(workspace, ".env.local"), resolve(workspace, ".env")], quiet: true });
const previewAI = resolvePreviewAI(process.env);
const databaseDir = resolve(process.env.PREVIEW_DATA_DIR ?? ".local-preview/postgres");
const postgresPort = Number(process.env.PREVIEW_POSTGRES_PORT ?? "55433");
const webPort = Number(process.env.PREVIEW_WEB_PORT ?? "3100");
const networkMode = process.env.PREVIEW_NETWORK === "lan" ? "lan" : "local";
const databaseUser = "thinktutor_preview";
const databasePassword = "thinktutor-local-preview-only";
const databaseName = "thinktutor_preview";
const shadowDatabaseName = "thinktutor_preview_shadow";
const previewPassword = process.env.PREVIEW_PASSWORD ?? "ThinkTutor-Preview-2026!";
const require = createRequire(import.meta.url);

function findLanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((candidate) => candidate.family === "IPv4" && !candidate.internal);
    if (address) return address.address;
  }
  throw new Error("未找到可用的局域网 IPv4 地址，请检查网络连接或设置 PREVIEW_PUBLIC_HOST。");
}

const publicHost = process.env.PREVIEW_PUBLIC_HOST?.trim() || (networkMode === "lan" ? findLanAddress() : "127.0.0.1");
const listenHost = networkMode === "lan" ? "0.0.0.0" : "127.0.0.1";

if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\d{1,3}(?:\.\d{1,3}){3})$/.test(publicHost)) {
  throw new Error("PREVIEW_PUBLIC_HOST must be a hostname or IPv4 address without a protocol or port.");
}

if (!databaseDir.startsWith(`${workspace}\\`) && !databaseDir.startsWith(`${workspace}/`)) {
  throw new Error("Local preview database directory escaped the workspace.");
}
if (!Number.isInteger(postgresPort) || postgresPort < 1024 || postgresPort > 65_535) {
  throw new Error("PREVIEW_POSTGRES_PORT must be an integer between 1024 and 65535.");
}
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65_535) {
  throw new Error("PREVIEW_WEB_PORT must be an integer between 1024 and 65535.");
}

const postgres = new EmbeddedPostgres({
  databaseDir,
  port: postgresPort,
  user: databaseUser,
  password: databasePassword,
  authMethod: "scram-sha-256",
  persistent: true,
  onLog: (message) => {
    if (process.env.POSTGRES_VERBOSE === "true") process.stdout.write(`${message}\n`);
  },
  onError: (error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`),
});

const databaseUrl = `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databasePassword)}@127.0.0.1:${postgresPort}/${databaseName}`;
const shadowDatabaseUrl = `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(databasePassword)}@127.0.0.1:${postgresPort}/${shadowDatabaseName}`;
const previewEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
  DEPLOYMENT_ENV: "development",
  APP_URL: `http://${publicHost}:${webPort}`,
  DATABASE_URL: databaseUrl,
  SHADOW_DATABASE_URL: shadowDatabaseUrl,
  AUTH_SECRET: "local-preview-auth-secret-at-least-32-characters",
  STORAGE_SIGNING_SECRET: "local-preview-storage-secret-at-least-32-characters",
  ...previewAI,
  AUTH_COOKIE_SECURE: "false",
  THINKTUTOR_DIST_DIR: process.env.PREVIEW_DIST_DIR ?? process.env.THINKTUTOR_DIST_DIR ?? ".next/local-preview",
  ALLOW_DRAFT_KNOWLEDGE: process.env.PREVIEW_ALLOW_DRAFT_KNOWLEDGE ?? process.env.ALLOW_DRAFT_KNOWLEDGE ?? "false",
  STORAGE_PROVIDER: "local",
  LOCAL_STORAGE_ROOT: ".local-preview/uploads",
  DEV_SEED_PASSWORD: previewPassword,
  LOCAL_PREVIEW: "true",
  LOCAL_PREVIEW_PASSWORD: previewPassword,
  REDIS_URL: "",
  RATE_LIMIT_AI_PER_DAY: previewAI.AI_PROVIDER === "mock" ? "10000" : process.env.RATE_LIMIT_AI_PER_DAY ?? "120",
  RATE_LIMIT_AI_PER_MINUTE: previewAI.AI_PROVIDER === "mock" ? "1000" : process.env.RATE_LIMIT_AI_PER_MINUTE ?? "12",
  RATE_LIMIT_LOGIN_PER_15M: "1000",
  RATE_LIMIT_REGISTER_PER_HOUR: "1000",
  PORT: String(webPort),
};

function spawnNext(argumentsList: string[]): ChildProcess {
  return spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), ...argumentsList], {
    cwd: workspace,
    env: previewEnv,
    shell: false,
    stdio: "inherit",
  });
}

async function runNodeCli(script: string, argumentsList: string[]): Promise<void> {
  if ([script, ...argumentsList].some((value) => /[&|<>^%!\r\n]/.test(value))) {
    throw new Error("Preview command contains unsupported shell metacharacters.");
  }
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve(script), ...argumentsList], {
      cwd: workspace,
      env: previewEnv,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${script} failed with exit code ${code ?? 1}.`));
    });
  });
}

async function databaseExists(name: string): Promise<boolean> {
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const result = await client.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists", [name]);
    return result.rows[0]?.exists ?? false;
  } finally {
    await client.end();
  }
}

async function ensureDatabase(name: string): Promise<void> {
  if (!(await databaseExists(name))) await postgres.createDatabase(name);
}

async function isPortListening(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveResult) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolveResult(result);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function runExecutable(executable: string, argumentsList: string[]): Promise<number> {
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(executable, argumentsList, { cwd: workspace, shell: false, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

async function recoverInterruptedPostgres(): Promise<void> {
  const pidFile = resolve(databaseDir, "postmaster.pid");
  try {
    await access(pidFile);
  } catch {
    return;
  }
  if (await isPortListening(postgresPort)) {
    throw new Error(`本地预览数据库端口 ${postgresPort} 已在使用。若预览已启动，请直接访问网页或先按 Ctrl+C 停止。`);
  }

  if (process.platform === "win32") {
    const embeddedEntry = require.resolve("embedded-postgres");
    const pgCtl = resolve(dirname(embeddedEntry), "..", "..", "@embedded-postgres", "windows-x64", "native", "bin", "pg_ctl.exe");
    await access(pgCtl);
    const status = await runExecutable(pgCtl, ["status", "-D", databaseDir]);
    if (status === 0) await runExecutable(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w"]);
  }

  if (!(await isPortListening(postgresPort))) {
    await unlink(pidFile).catch((error: unknown) => {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") throw error;
    });
  }
}

async function waitForExit(child: ChildProcess): Promise<number> {
  return await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error("停止本地网页服务超时。")), 15_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    if (!child.kill()) {
      clearTimeout(timeout);
      reject(new Error("无法停止本地网页服务。"));
    }
  });
}

async function stopPostgres(): Promise<void> {
  if (process.platform !== "win32") {
    await postgres.stop();
    return;
  }
  const candidate: unknown = Reflect.get(postgres, "process");
  const child = candidate as ChildProcess | undefined;
  if (child && child.exitCode === null) await stopChild(child);
  Reflect.set(postgres, "process", undefined);
}

let web: ChildProcess | undefined;
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (web && web.exitCode === null) {
    await stopChild(web).catch((error: unknown) => {
      process.stderr.write(`无法停止本地网页服务：${error instanceof Error ? error.message : String(error)}\n`);
    });
  }
  await stopPostgres().catch((error: unknown) => {
    process.stderr.write(`无法停止本地预览数据库：${error instanceof Error ? error.message : String(error)}\n`);
  });
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function main(): Promise<void> {
  if (await isPortListening(webPort)) {
    throw new Error(`网页端口 ${webPort} 已在使用。若预览已启动，请直接访问网页或先按 Ctrl+C 停止。`);
  }
  try {
    await access(resolve(databaseDir, "PG_VERSION"));
  } catch {
    process.stdout.write("首次运行：正在初始化本地 PostgreSQL…\n");
    await postgres.initialise();
  }
  await recoverInterruptedPostgres();
  await postgres.start();
  await ensureDatabase(databaseName);
  await ensureDatabase(shadowDatabaseName);

  process.stdout.write("正在应用数据库 migration…\n");
  await runNodeCli("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  process.stdout.write("正在准备可重复使用的演示账号与课程…\n");
  await runNodeCli("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"]);

  process.stdout.write(`\n问思学伴本地成果网页已准备：\n`);
  process.stdout.write(`  浏览器地址：http://${publicHost}:${webPort}\n`);
  if (networkMode === "local") {
    process.stdout.write(`  备用地址：http://localhost:${webPort}\n`);
    process.stdout.write("  系统代理：可以保持开启；请让 localhost、127.0.0.1 或 127.* 走直连/代理绕过\n");
  }
  process.stdout.write(`  访问范围：${networkMode === "lan" ? "同一可信局域网（请勿直接暴露到公网）" : "仅本机"}\n`);
  process.stdout.write(`  学生：student@example.test\n`);
  process.stdout.write(`  教师：teacher@example.test\n`);
  process.stdout.write(`  管理员：admin@example.test\n`);
  process.stdout.write(`  统一密码：${previewPassword}\n`);
  process.stdout.write(previewAI.AI_PROVIDER === "mock" ? "  AI：Mock（确定性、不会产生费用）\n" : "  AI：DeepSeek（真实模型，调用将产生费用）\n");
  process.stdout.write("  数据：保存在 .local-preview，Ctrl+C 后下次仍可恢复\n\n");

  web = spawnNext(["dev", "-H", listenHost, "-p", String(webPort)]);
  const exitCode = await waitForExit(web);
  if (!stopping && exitCode !== 0) throw new Error(`Next.js preview exited with code ${exitCode}.`);
}

function formatStartupError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  if (error === undefined) return "本地预览启动失败，但底层依赖没有返回具体错误。请关闭旧的预览窗口后重试；如果仍失败，使用 pnpm preview 查看上方日志。";
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

let exitCode = 0;
try {
  await main();
} catch (error: unknown) {
  exitCode = 1;
  process.stderr.write(`${formatStartupError(error)}\n`);
} finally {
  await stop();
}

if (exitCode !== 0) process.exit(exitCode);
