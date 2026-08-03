import { cleanTestDatabase } from "./test-database";

cleanTestDatabase({
  ...process.env,
  AI_PROVIDER: "mock",
  DATABASE_URL: "file:./e2e.db",
});
