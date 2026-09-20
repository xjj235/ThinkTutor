import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", globals: true, fileParallelism: false, include: ["tests/smoke/knowledge-qa-live.test.ts"] },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "server-only": path.resolve(import.meta.dirname, "tests/server-only.ts") } },
});
