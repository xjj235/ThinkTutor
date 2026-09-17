import "server-only";

import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : undefined))
  .optional();

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DEPLOYMENT_ENV: z.enum(["development", "test", "competition", "production"]).default("development"),
    LOCAL_PREVIEW: booleanString,
    ALLOW_DRAFT_KNOWLEDGE: booleanString,
    APP_URL: z.url().default("http://127.0.0.1:3000"),
    AUTH_SECRET: optionalString,
    STORAGE_SIGNING_SECRET: optionalString,
    DATABASE_URL: z
      .string()
      .trim()
      .startsWith("postgresql://")
      .default("postgresql://thinktutor@127.0.0.1:55432/thinktutor_dev"),
    AI_PROVIDER: z.enum(["mock", "deepseek"]).default("mock"),
    AI_PSEUDONYM_SECRET: optionalString,
    DEEPSEEK_API_KEY: optionalString,
    DEEPSEEK_BASE_URL: z.url().default("https://api.deepseek.com"),
    DEEPSEEK_MODEL: z.string().trim().min(1).default("deepseek-v4-flash"),
    DEEPSEEK_WEB_SEARCH_FALLBACK: booleanString,
    AI_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
    DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(45_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(2),
    AI_CONTEXT_MAX_CHARS: z.coerce.number().int().min(2_000).max(100_000).default(24_000),
    AI_RECENT_MESSAGE_LIMIT: z.coerce.number().int().min(4).max(40).default(16),
    AI_RETRIEVAL_CHUNK_LIMIT: z.coerce.number().int().min(1).max(12).default(6),
    AI_DAILY_USER_LIMIT: z.coerce.number().int().min(1).max(10_000).default(120),
    RATE_LIMIT_LOGIN_PER_15M: z.coerce.number().int().min(1).max(10_000).default(10),
    RATE_LIMIT_REGISTER_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(5),
    RATE_LIMIT_AI_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(12),
    RATE_LIMIT_AI_PER_DAY: z.coerce.number().int().min(1).max(100_000).default(120),
    MAX_REFERENCE_TEXT_LENGTH: z.coerce.number().int().positive().max(50_000).default(12_000),
    MAX_MESSAGES_PER_SESSION: z.coerce.number().int().positive().max(300).default(80),
    AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
    AUTH_COOKIE_SECURE: booleanString,
    REDIS_URL: optionalString,
    STORAGE_PROVIDER: z.enum(["local", "oss"]).default("local"),
    LOCAL_STORAGE_ROOT: z.string().trim().min(1).default(".data/uploads"),
    OSS_REGION: optionalString,
    OSS_BUCKET: optionalString,
    OSS_ENDPOINT: optionalString,
    OSS_ACCESS_KEY_ID: optionalString,
    OSS_ACCESS_KEY_SECRET: optionalString,
    OSS_STS_TOKEN: optionalString,
    OSS_ROLE_ARN: optionalString,
    MATERIAL_MAX_BYTES: z.coerce.number().int().min(1_024).max(100 * 1024 * 1024).default(20 * 1024 * 1024),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(20),
    DEEPSEEK_LIVE_TEST: booleanString,
  })
  .superRefine((env, context) => {
    if (["competition", "production"].includes(env.DEPLOYMENT_ENV) && env.LOCAL_PREVIEW) {
      context.addIssue({ code: "custom", path: ["LOCAL_PREVIEW"], message: "Public deployments must not enable local preview accounts." });
    }
    if (env.DEPLOYMENT_ENV === "competition") {
      if (!env.APP_URL.startsWith("https://")) {
        context.addIssue({ code: "custom", path: ["APP_URL"], message: "Competition deployment requires an HTTPS APP_URL." });
      }
      if (!env.AUTH_COOKIE_SECURE) {
        context.addIssue({ code: "custom", path: ["AUTH_COOKIE_SECURE"], message: "Competition deployment requires secure cookies." });
      }
      if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
        context.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "Competition deployment requires an AUTH_SECRET of at least 32 characters." });
      }
      if (!env.AI_PSEUDONYM_SECRET || env.AI_PSEUDONYM_SECRET.length < 32) {
        context.addIssue({ code: "custom", path: ["AI_PSEUDONYM_SECRET"], message: "Competition deployment requires an AI_PSEUDONYM_SECRET of at least 32 characters." });
      }
    }
    if (env.DEPLOYMENT_ENV === "production" && env.ALLOW_DRAFT_KNOWLEDGE) {
      context.addIssue({ code: "custom", path: ["ALLOW_DRAFT_KNOWLEDGE"], message: "Production must not enable draft knowledge." });
    }
    if (env.AI_PROVIDER === "deepseek" && !env.DEEPSEEK_API_KEY) {
      context.addIssue({ code: "custom", path: ["DEEPSEEK_API_KEY"], message: "DeepSeek mode requires DEEPSEEK_API_KEY." });
    }
    if (env.AI_PROVIDER === "deepseek" && (!env.AI_PSEUDONYM_SECRET || env.AI_PSEUDONYM_SECRET.length < 32)) {
      context.addIssue({ code: "custom", path: ["AI_PSEUDONYM_SECRET"], message: "DeepSeek mode requires a dedicated pseudonym secret of at least 32 characters." });
    }
    if (env.DEPLOYMENT_ENV === "production" && env.DEEPSEEK_MODEL !== "deepseek-v4-flash") {
      context.addIssue({ code: "custom", path: ["DEEPSEEK_MODEL"], message: "Production requires deepseek-v4-flash." });
    }
    if (env.DEPLOYMENT_ENV === "production" && env.AI_PROVIDER !== "deepseek") {
      context.addIssue({ code: "custom", path: ["AI_PROVIDER"], message: "Production requires the DeepSeek provider." });
    }
    if (env.DEPLOYMENT_ENV === "production" && (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)) {
      context.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "Production requires an AUTH_SECRET of at least 32 characters." });
    }
    if (env.STORAGE_PROVIDER === "local" && (!env.STORAGE_SIGNING_SECRET || env.STORAGE_SIGNING_SECRET.length < 32)) {
      context.addIssue({ code: "custom", path: ["STORAGE_SIGNING_SECRET"], message: "Local storage requires a dedicated signing secret of at least 32 characters." });
    }
    if (env.DEPLOYMENT_ENV === "production" && env.STORAGE_PROVIDER !== "oss") {
      context.addIssue({ code: "custom", path: ["STORAGE_PROVIDER"], message: "Production requires OSS storage." });
    }
    if (env.STORAGE_PROVIDER === "oss" && (!env.OSS_REGION || !env.OSS_BUCKET)) {
      context.addIssue({ code: "custom", path: ["OSS_BUCKET"], message: "OSS storage requires OSS_REGION and OSS_BUCKET." });
    }
    if (Boolean(env.OSS_ACCESS_KEY_ID) !== Boolean(env.OSS_ACCESS_KEY_SECRET)) {
      context.addIssue({ code: "custom", path: ["OSS_ACCESS_KEY_SECRET"], message: "OSS access key id and secret must be configured together." });
    }
    if (env.OSS_ROLE_ARN && (!env.OSS_ACCESS_KEY_ID || !env.OSS_ACCESS_KEY_SECRET)) {
      context.addIssue({ code: "custom", path: ["OSS_ROLE_ARN"], message: "OSS_ROLE_ARN requires source access keys; leave it empty for an ECS RAM Role." });
    }
    if (env.DEPLOYMENT_ENV === "production" && !env.REDIS_URL) {
      context.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Production requires Tair/Redis." });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

const forbiddenPublicSecretNames = [
  "NEXT_PUBLIC_AUTH_SECRET",
  "NEXT_PUBLIC_AI_PSEUDONYM_SECRET",
  "NEXT_PUBLIC_DATABASE_URL",
  "NEXT_PUBLIC_DEEPSEEK_API_KEY",
  "NEXT_PUBLIC_OSS_ACCESS_KEY_SECRET",
  "NEXT_PUBLIC_STORAGE_SIGNING_SECRET",
] as const;

export function assertNoPublicSecrets(environment: Readonly<Record<string, string | undefined>>): void {
  const exposedName = forbiddenPublicSecretNames.find((name) => Boolean(environment[name]?.trim()));
  if (exposedName) throw new Error(`Refusing to start: ${exposedName} must never be exposed to the browser.`);
}

export function getServerEnv(): ServerEnv {
  assertNoPublicSecrets(process.env);
  if (process.env.NODE_ENV === "test") return serverEnvSchema.parse(process.env);
  cachedEnv ??= serverEnvSchema.parse(process.env);
  return cachedEnv;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
}
