import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { resolve } from "node:path";

// Build without a live database or model call. Runtime secrets stay on Render.
const env = {
  ...process.env,
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "development",
  AI_PROVIDER: "mock",
  LOCAL_PREVIEW: "false",
  ALLOW_DRAFT_KNOWLEDGE: "false",
  STORAGE_PROVIDER: "local",
  STORAGE_SIGNING_SECRET: "build-only-storage-signing-secret-never-use-at-runtime",
  THINKTUTOR_DIST_DIR: ".next",
  NEXT_TELEMETRY_DISABLED: "1",
};
const build = spawnSync(process.execPath, [resolve("node_modules/next/dist/bin/next"), "build"], { env, stdio: "inherit" });
if (build.error || build.status !== 0) process.exit(build.status ?? 1);

// Next standalone does not copy these browser assets automatically.
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
