import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(".");
const baseUrl = "http://127.0.0.1:3000";

function runNode(script: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [resolve(script), ...args], {
    cwd: workspace,
    env,
    shell: false,
    stdio: "inherit",
  });
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js test server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health/live`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The server is still compiling or has not opened its listener yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Timed out waiting for the Next.js test server.");
}

async function waitForExit(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out stopping the Next.js test server.")), 15_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
    if (!child.kill()) {
      clearTimeout(timeout);
      reject(new Error("Failed to stop the Next.js test server."));
    }
  });
}

const serverEnv: NodeJS.ProcessEnv = {
  ...process.env,
  AI_PROVIDER: "mock",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "test-only-auth-secret-at-least-32-characters",
  STORAGE_SIGNING_SECRET: process.env.STORAGE_SIGNING_SECRET ?? "test-only-storage-secret-at-least-32-characters",
  AI_PSEUDONYM_SECRET: process.env.AI_PSEUDONYM_SECRET ?? "test-only-ai-pseudonym-secret-at-least-32-characters",
  RATE_LIMIT_AI_PER_DAY: "10000",
  RATE_LIMIT_AI_PER_MINUTE: "1000",
  RATE_LIMIT_LOGIN_PER_15M: "1000",
  RATE_LIMIT_REGISTER_PER_HOUR: "1000",
};

const server = runNode("node_modules/next/dist/bin/next", ["dev", "-H", "127.0.0.1"], serverEnv);
let exitCode = 1;
try {
  await waitForServer(server);
  const requestedTests = process.argv.slice(2);
  const playwright = runNode("node_modules/@playwright/test/cli.js", ["test", ...requestedTests], {
    ...serverEnv,
    E2E_EXTERNAL_SERVER: "true",
  });
  exitCode = await waitForExit(playwright);
} finally {
  await stopChild(server);
}

if (exitCode !== 0) throw new Error(`Playwright failed with exit code ${exitCode}.`);
