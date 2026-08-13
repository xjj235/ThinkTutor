import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations-postgresql",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://thinktutor@127.0.0.1:55432/thinktutor_dev",
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ?? "postgresql://thinktutor@127.0.0.1:55432/thinktutor_shadow",
  },
});
