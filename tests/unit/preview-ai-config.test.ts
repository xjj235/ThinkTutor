import { describe, expect, it } from "vitest";
import { resolvePreviewAI } from "../../scripts/preview-ai-config";

describe("local preview AI opt-in", () => {
  it("keeps preview mock unless the dedicated option explicitly enables paid calls", () => {
    expect(resolvePreviewAI({ AI_PROVIDER: "deepseek" }).AI_PROVIDER).toBe("mock");
    expect(resolvePreviewAI({ PREVIEW_AI_PROVIDER: "mock" }).AI_PROVIDER).toBe("mock");
  });

  it("uses a dedicated secret for an explicitly enabled real-model preview", () => {
    const secret = "preview-test-pseudonym-secret-at-least-32-characters";
    expect(resolvePreviewAI({ PREVIEW_AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key", AI_PSEUDONYM_SECRET: secret })).toEqual({ AI_PROVIDER: "deepseek", AI_PSEUDONYM_SECRET: secret });
  });

  it("rejects missing credentials without silently falling back to mock", () => {
    expect(() => resolvePreviewAI({ PREVIEW_AI_PROVIDER: "deepseek" })).toThrow("DEEPSEEK_API_KEY");
    expect(() => resolvePreviewAI({ PREVIEW_AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key" })).toThrow("AI_PSEUDONYM_SECRET");
    expect(() => resolvePreviewAI({ PREVIEW_AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "   ", AI_PSEUDONYM_SECRET: "short" })).toThrow();
  });

  it("rejects unknown providers without revealing a configured key", () => {
    const key = "sensitive-test-key-never-print";
    try { resolvePreviewAI({ PREVIEW_AI_PROVIDER: "invalid", DEEPSEEK_API_KEY: key }); }
    catch (error) { expect(String(error)).not.toContain(key); return; }
    expect.fail("Unknown provider must be rejected");
  });
});
