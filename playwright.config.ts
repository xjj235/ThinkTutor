import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: process.env.E2E_EXTERNAL_SERVER === "true" ? undefined : {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      AI_PROVIDER: "mock",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://thinktutor@127.0.0.1:55432/thinktutor_test",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-only-auth-secret-at-least-32-characters",
      RATE_LIMIT_LOGIN_PER_15M: "1000",
      RATE_LIMIT_REGISTER_PER_HOUR: "1000",
      RATE_LIMIT_AI_PER_MINUTE: "1000",
      RATE_LIMIT_AI_PER_DAY: "10000",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
