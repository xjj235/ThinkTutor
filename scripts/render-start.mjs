import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";

const env = {
  ...process.env,
  APP_URL: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL,
  HOSTNAME: "0.0.0.0",
  PORT: process.env.PORT || "10000",
};
// Fail before migrations if this is accidentally configured as a local preview.
const result = z.object({
  NODE_ENV: z.literal("production"),
  DEPLOYMENT_ENV: z.literal("competition"),
  APP_URL: z.url().refine((value) => new URL(value).protocol === "https:"),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  AUTH_COOKIE_SECURE: z.literal("true"),
  LOCAL_PREVIEW: z.literal("false").optional(),
  AUTH_SECRET: z.string().min(32),
  AI_PSEUDONYM_SECRET: z.string().min(32),
  STORAGE_SIGNING_SECRET: z.string().min(32),
  AI_PROVIDER: z.enum(["deepseek", "mock"]),
  DEEPSEEK_API_KEY: z.string().trim().optional(),
  DEEPSEEK_BASE_URL: z.url().optional(),
  DEEPSEEK_MODEL: z.string().trim().min(1).optional(),
}).superRefine((settings, context) => {
  if (settings.AI_PROVIDER === "deepseek" && !settings.DEEPSEEK_API_KEY) {
    context.addIssue({ code: "custom", path: ["DEEPSEEK_API_KEY"], message: "Required for DeepSeek." });
  }
}).safeParse(env);
if (!result.success) {
  console.error(`Competition configuration missing or invalid: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`);
  process.exit(1);
}

let child;
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}
function run(script, args = []) {
  return new Promise((accept, reject) => {
    child = spawn(process.execPath, [resolve(script), ...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => accept(code ?? 1));
  });
}
// Free Render has no pre-deploy job. Migrate once at startup; never seed demo accounts.
try {
  const migration = await run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  if (migration !== 0 || stopping) process.exit(migration || 1);
  process.exit(await run(".next/standalone/server.js"));
} catch {
  console.error("Competition service could not start. Check deployment logs and configuration.");
  process.exit(1);
}
