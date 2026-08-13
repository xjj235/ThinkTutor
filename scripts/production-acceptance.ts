import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  APP_URL: z.url().refine((value) => value.startsWith("https://"), "APP_URL must use HTTPS"),
  DEPLOYMENT_ENV: z.literal("production"),
  AI_PROVIDER: z.literal("deepseek"),
  STORAGE_PROVIDER: z.literal("oss"),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  REDIS_URL: z.string().min(1),
  OSS_REGION: z.string().min(1),
  OSS_BUCKET: z.string().min(1),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_MODEL: z.literal("deepseek-v4-flash"),
});

type Check = { name: string; pass: boolean; detail: string };

async function responseCheck(name: string, url: string, validate: (response: Response, body: unknown) => boolean): Promise<Check> {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    const body: unknown = await response.json().catch(() => undefined);
    return { name, pass: validate(response, body), detail: `HTTP ${response.status}` };
  } catch (error) {
    return { name, pass: false, detail: error instanceof Error ? error.message : "request failed" };
  }
}

async function main(): Promise<void> {
  const config = configSchema.parse(process.env);
  const origin = new URL(config.APP_URL).origin;
  const checks: Check[] = [];
  checks.push(await responseCheck("HTTPS HTML", `${origin}/`, (response) => response.ok && (response.headers.get("content-type") ?? "").includes("text/html")));
  checks.push(await responseCheck("live probe", `${origin}/api/health/live`, (response, body) => response.ok && typeof body === "object" && body !== null));
  checks.push(await responseCheck("RDS + Tair ready probe", `${origin}/api/health/ready`, (response, body) => {
    if (!response.ok || typeof body !== "object" || body === null || !("data" in body)) return false;
    const data = (body as { data?: { database?: unknown; redis?: unknown; aiProvider?: unknown } }).data;
    return data?.database === "ok" && data.redis === "ok" && data.aiProvider === "deepseek";
  }));
  const homepage = await fetch(`${origin}/`, { signal: AbortSignal.timeout(15_000) });
  const headers = homepage.headers;
  checks.push({ name: "HSTS", pass: (headers.get("strict-transport-security") ?? "").includes("max-age="), detail: headers.get("strict-transport-security") ?? "missing" });
  checks.push({ name: "frame protection", pass: Boolean(headers.get("x-frame-options") || (headers.get("content-security-policy") ?? "").includes("frame-ancestors")), detail: headers.get("x-frame-options") ?? "CSP frame-ancestors" });

  for (const check of checks) process.stdout.write(`${check.pass ? "PASS" : "FAIL"} ${check.name}: ${check.detail}\n`);
  process.stdout.write("NOTE OSS private upload/delete, DeepSeek paid inference, ECS security groups, RDS backups, and Tair ACLs require the manual production checklist. This command does not print secrets.\n");
  if (checks.some((check) => !check.pass)) process.exitCode = 1;
}

await main();
