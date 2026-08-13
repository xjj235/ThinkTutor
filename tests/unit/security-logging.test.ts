import { describe, expect, it } from "vitest";
import { safeErrorForLog } from "@/lib/logger";

describe("safe security logging", () => {
  it("keeps only an error type and machine code", () => {
    const error = Object.assign(
      new Error("postgresql://user:password@private-host/db?token=secret-student-content"),
      { code: "P2024", cause: new Error("DEEPSEEK_API_KEY=secret") },
    );
    const fields = safeErrorForLog(error);
    expect(fields).toEqual({ errorType: "Error", errorCode: "P2024" });
    expect(JSON.stringify(fields)).not.toContain("password");
    expect(JSON.stringify(fields)).not.toContain("secret-student-content");
    expect(JSON.stringify(fields)).not.toContain("DEEPSEEK_API_KEY");
  });
});
