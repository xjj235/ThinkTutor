import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", globals: true, include: ["tests/smoke/deepseek-live.test.ts"], testTimeout: 90_000 }, resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/server-only.ts") } } });
