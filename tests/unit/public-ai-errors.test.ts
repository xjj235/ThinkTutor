import { describe, expect, it } from "vitest";
import { apiFail, handleRouteError } from "@/lib/api-response";
import { ClientApiError, feedbackForError, readApiResponse } from "@/lib/client-api";
import { AIProviderError } from "@/lib/errors";

const internalMessage = "追问内容未通过答案暴露、题设或前提检查，请重试。";
const publicMessage = "学习教练暂时未能生成回复，请重试。";

describe("public AI failure messages", () => {
  it("redacts provider detail at the HTTP boundary and retains diagnostic metadata", async () => {
    const error = new AIProviderError("AI_INVALID_OUTPUT", internalMessage, 502, true);
    const response = handleRouteError(error, "request-public-error-1");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "AI_INVALID_OUTPUT", message: publicMessage, retryable: true },
      requestId: "request-public-error-1",
    });
    expect(error.message).toBe(internalMessage);
    expect(error.code).toBe("AI_INVALID_OUTPUT");
  });

  it.each(["AI_AUTH_ERROR", "AI_PROVIDER_ERROR", "AI_NEW_REVIEW_FAILURE"])("uses a public fallback for %s", async (code) => {
    const response = apiFail(code, "internal model configuration or review detail", 503, false, "request-public-error-2");
    expect(await response.json()).toEqual({
      error: { code, message: "学习服务暂时不可用，请稍后重试。", retryable: false },
      requestId: "request-public-error-2",
    });
  });

  it("keeps actionable user validation feedback", async () => {
    const response = apiFail("VALIDATION_ERROR", "请填写本次回答。", 400, false, "request-public-error-3");
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", message: "请填写本次回答。", retryable: false } });
  });

  it("maps a legacy response before AsyncFeedback receives it, keeping the code and retry flag", async () => {
    const response = Response.json({ error: { code: "AI_INVALID_OUTPUT", message: internalMessage, retryable: true } }, { status: 502 });
    const error = await readApiResponse(response, "请求失败。").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClientApiError);
    expect(error).toMatchObject({ code: "AI_INVALID_OUTPUT", message: publicMessage, retryable: true });
    expect(feedbackForError(error, "请求失败。")).toEqual({ kind: "error", message: publicMessage, retryable: true });
  });

  it("preserves successful data", async () => {
    expect(await readApiResponse(Response.json({ data: { sessionId: "session-1" } }), "请求失败。")).toEqual({ sessionId: "session-1" });
  });
});
