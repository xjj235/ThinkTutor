import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertNoPublicSecrets, getServerEnv, resetServerEnvForTests } from "@/lib/env";

const keys = [
  "NODE_ENV",
  "DEPLOYMENT_ENV",
  "LOCAL_PREVIEW",
  "APP_URL",
  "AUTH_SECRET",
  "AUTH_COOKIE_SECURE",
  "AI_PSEUDONYM_SECRET",
  "STORAGE_SIGNING_SECRET",
  "STORAGE_PROVIDER",
  "ALLOW_DRAFT_KNOWLEDGE",
  "REDIS_URL",
  "AI_PROVIDER",
  "AI_TIMEOUT_MS",
  "MAX_REFERENCE_TEXT_LENGTH",
  "MAX_USER_MESSAGE_LENGTH",
  "MAX_MESSAGES_PER_SESSION",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "OSS_REGION",
  "OSS_BUCKET",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_ROLE_ARN",
] as const;

beforeEach(() => {
  for (const key of keys) vi.stubEnv(key, undefined);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_SECRET", "unit-test-auth-secret-at-least-32-characters");
  vi.stubEnv("STORAGE_SIGNING_SECRET", "unit-test-storage-secret-at-least-32-characters");
  vi.stubEnv("AI_PSEUDONYM_SECRET", "unit-test-pseudonym-secret-at-least-32-characters");
  resetServerEnvForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvForTests();
});

function configureCompetition(): void {
  process.env.DEPLOYMENT_ENV = "competition";
  process.env.APP_URL = "https://thinktutor-test.onrender.com";
  process.env.AUTH_COOKIE_SECURE = "true";
}

function configureProduction(): void {
  process.env.DEPLOYMENT_ENV = "production";
  process.env.APP_URL = "https://thinktutor.example.com";
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "unit-test-deepseek-key";
  process.env.STORAGE_PROVIDER = "oss";
  process.env.OSS_REGION = "oss-cn-chengdu";
  process.env.OSS_BUCKET = "unit-test-private-bucket";
  process.env.REDIS_URL = "redis://127.0.0.1:6379";
}

describe("server environment", () => {
  it("uses the documented defaults", () => {
    const env = getServerEnv();
    expect(env.AI_TIMEOUT_MS).toBe(30_000);
    expect(env.MAX_REFERENCE_TEXT_LENGTH).toBe(12_000);
    expect(env).not.toHaveProperty("MAX_USER_MESSAGE_LENGTH");
    expect(env.MAX_MESSAGES_PER_SESSION).toBe(80);
    expect(env.ALLOW_DRAFT_KNOWLEDGE).toBe(false);
    expect(env.LOCAL_PREVIEW).toBe(false);
  });

  it("parses supported runtime overrides", () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "unit-test-deepseek-key";
    process.env.AI_TIMEOUT_MS = "45000";
    process.env.MAX_REFERENCE_TEXT_LENGTH = "7000";
    process.env.MAX_USER_MESSAGE_LENGTH = "1500";
    process.env.MAX_MESSAGES_PER_SESSION = "35";

    expect(getServerEnv()).toMatchObject({
      AI_PROVIDER: "deepseek",
      AI_TIMEOUT_MS: 45_000,
      MAX_REFERENCE_TEXT_LENGTH: 7_000,
      MAX_MESSAGES_PER_SESSION: 35,
    });
    expect(getServerEnv()).not.toHaveProperty("MAX_USER_MESSAGE_LENGTH");
  });

  it("requires complete OSS source credentials for cross-account AssumeRole", () => {
    process.env.OSS_ROLE_ARN = "acs:ram::123456789:role/thinktutor-oss";
    delete process.env.OSS_ACCESS_KEY_ID;
    delete process.env.OSS_ACCESS_KEY_SECRET;
    expect(() => getServerEnv()).toThrow("OSS_ROLE_ARN requires source access keys");

    process.env.OSS_ACCESS_KEY_ID = "test-access-key-id";
    process.env.OSS_ACCESS_KEY_SECRET = "test-access-key-secret";
    expect(getServerEnv().OSS_ROLE_ARN).toContain("thinktutor-oss");
  });

  it("refuses browser-prefixed secret variables without exposing their value", () => {
    const secret = "never-include-this-secret-value";
    expect(() => assertNoPublicSecrets({ NEXT_PUBLIC_DEEPSEEK_API_KEY: secret })).toThrow(
      "NEXT_PUBLIC_DEEPSEEK_API_KEY",
    );
    try {
      assertNoPublicSecrets({ NEXT_PUBLIC_DEEPSEEK_API_KEY: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each(["mock", "deepseek"])("accepts a secure competition deployment using %s", (provider) => {
    configureCompetition();
    vi.stubEnv("NODE_ENV", "production");
    process.env.AI_PROVIDER = provider;
    if (provider === "deepseek") process.env.DEEPSEEK_API_KEY = "unit-test-deepseek-key";

    expect(getServerEnv()).toMatchObject({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "competition",
      AI_PROVIDER: provider,
      STORAGE_PROVIDER: "local",
      AUTH_COOKIE_SECURE: true,
      ALLOW_DRAFT_KNOWLEDGE: false,
      LOCAL_PREVIEW: false,
    });
  });

  it.each([
    ["APP_URL", "http://thinktutor-test.onrender.com", "HTTPS APP_URL"],
    ["AUTH_COOKIE_SECURE", "false", "secure cookies"],
    ["AUTH_COOKIE_SECURE", undefined, "secure cookies"],
    ["AUTH_SECRET", "short", "AUTH_SECRET"],
    ["AUTH_SECRET", undefined, "AUTH_SECRET"],
    ["AI_PSEUDONYM_SECRET", "short", "AI_PSEUDONYM_SECRET"],
    ["AI_PSEUDONYM_SECRET", undefined, "AI_PSEUDONYM_SECRET"],
    ["LOCAL_PREVIEW", "true", "local preview accounts"],
  ])("rejects unsafe competition %s=%s", (key, value, message) => {
    configureCompetition();
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    expect(() => getServerEnv()).toThrow(message);
  });

  it("still requires a model key for real AI in competition", () => {
    configureCompetition();
    process.env.AI_PROVIDER = "deepseek";
    expect(() => getServerEnv()).toThrow("DeepSeek mode requires DEEPSEEK_API_KEY");
  });

  it("preserves local preview access for development and LAN use", () => {
    process.env.LOCAL_PREVIEW = "true";
    process.env.APP_URL = "http://192.168.1.20:3100";
    expect(getServerEnv()).toMatchObject({ DEPLOYMENT_ENV: "development", LOCAL_PREVIEW: true, AUTH_COOKIE_SECURE: false });
  });

  it.each([
    ["AI_PROVIDER", "mock", "Production requires the DeepSeek provider"],
    ["DEEPSEEK_MODEL", "other-model", "Production requires deepseek-v4-flash"],
    ["STORAGE_PROVIDER", "local", "Production requires OSS storage"],
    ["REDIS_URL", undefined, "Production requires Tair/Redis"],
    ["ALLOW_DRAFT_KNOWLEDGE", "true", "Production must not enable draft knowledge"],
    ["AUTH_SECRET", "short", "Production requires an AUTH_SECRET"],
    ["LOCAL_PREVIEW", "true", "local preview accounts"],
  ])("keeps production safeguards for %s", (key, value, message) => {
    configureProduction();
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    expect(() => getServerEnv()).toThrow(message);
  });

  it("accepts the existing production provider configuration", () => {
    configureProduction();
    expect(getServerEnv()).toMatchObject({ DEPLOYMENT_ENV: "production", AI_PROVIDER: "deepseek", STORAGE_PROVIDER: "oss" });
  });
});
