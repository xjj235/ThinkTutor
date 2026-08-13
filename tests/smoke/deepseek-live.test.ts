import { describe, expect, it } from "vitest";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { diagnosticQuestionSchema } from "@/lib/contracts";

const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
describe.skipIf(!enabled)("DeepSeek live smoke", () => {
  it("lists and calls deepseek-v4-flash with valid structured diagnostic output", async () => {
    expect(process.env.DEEPSEEK_MODEL).toBe("deepseek-v4-flash");
    const response = await fetch(`${process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"}/models`, { headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` } });
    expect(response.ok).toBe(true);
    const diagnostic = await new DeepSeekProvider().createDiagnosticQuestion({ task: { course: undefined, chapter: undefined, referenceText: undefined, topic: "勾股定理", objective: "用自己的话解释定理条件", learnerLevel: "入门" } });
    expect(diagnosticQuestionSchema.safeParse(diagnostic).success).toBe(true);
  });
});
