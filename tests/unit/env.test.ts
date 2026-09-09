import { afterEach, describe, expect, it } from "vitest";
import { assertNoPublicSecrets, getServerEnv } from "@/lib/env";

const keys = [
  "AI_PROVIDER",
  "AI_TIMEOUT_MS",
  "MAX_REFERENCE_TEXT_LENGTH",
  "MAX_USER_MESSAGE_LENGTH",
  "MAX_MESSAGES_PER_SESSION",
  "DEEPSEEK_API_KEY",
  "OSS_ACCESS_KEY_ID",
  "OSS_ACCESS_KEY_SECRET",
  "OSS_ROLE_ARN",
] as const;

const originalValues = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
) as Record<(typeof keys)[number], string | undefined>;

afterEach(() => {
  for (const key of keys) {
    const value = originalValues[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("server environment", () => {
  it("uses the documented defaults", () => {
    for (const key of keys.slice(1)) {
      delete process.env[key];
    }

    const env = getServerEnv();
    expect(env.AI_TIMEOUT_MS).toBe(30_000);
    expect(env.MAX_REFERENCE_TEXT_LENGTH).toBe(12_000);
    expect(env).not.toHaveProperty("MAX_USER_MESSAGE_LENGTH");
    expect(env.MAX_MESSAGES_PER_SESSION).toBe(80);
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
});
