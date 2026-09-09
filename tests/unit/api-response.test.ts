import { describe, expect, it } from "vitest";
import { MAX_JSON_BODY_BYTES, readJson } from "@/lib/api-response";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sessions/test/answers", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
  });
}

describe("JSON transport safety independent of learning length", () => {
  it("accepts short and long Unicode answers without truncation", async () => {
    for (const answer of ["否", "答".repeat(20_001)]) {
      expect(await readJson(request(JSON.stringify({ answer })))).toEqual({ answer });
    }
  });

  it("accepts a JSON body exactly at the byte ceiling", async () => {
    const body = `"${"a".repeat(MAX_JSON_BODY_BYTES - 2)}"`;
    expect(await readJson(request(body))).toBe("a".repeat(MAX_JSON_BODY_BYTES - 2));
  });

  it.each<Record<string, string>>([{}, { "content-length": "1" }])("rejects oversized bodies even with missing or misleading headers", async (headers) => {
    await expect(readJson(request(JSON.stringify("字".repeat(MAX_JSON_BODY_BYTES / 2)), headers))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("rejects oversized declared bodies before reading", async () => {
    await expect(readJson(request("{}", { "content-length": String(MAX_JSON_BODY_BYTES + 1) }))).rejects.toMatchObject({ status: 413 });
  });

  it("preserves UTF-8 characters split across stream chunks", async () => {
    const bytes = new TextEncoder().encode('{"answer":"否"}');
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const streamed = new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(await readJson(streamed)).toEqual({ answer: "否" });
  });

  it("retains JSON content-type and syntax validation", async () => {
    await expect(readJson(request("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    await expect(readJson(request("{"))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request("http://localhost"))).rejects.toMatchObject({ status: 415 });
    await expect(readJson(new Request("http://localhost", { headers: { "content-type": "application/json" } }))).rejects.toMatchObject({ status: 400 });
  });
});
