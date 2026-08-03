import { describe, expect, it } from "vitest";
import { hasDuplicateClientRequest } from "@/lib/idempotency";

describe("idempotency", () => {
  it("detects repeated client request ids", () => {
    expect(
      hasDuplicateClientRequest(
        [{ clientRequestId: null }, { clientRequestId: "answer-1" }],
        "answer-1",
      ),
    ).toBe(true);
    expect(
      hasDuplicateClientRequest([{ clientRequestId: "answer-1" }], "answer-2"),
    ).toBe(false);
  });
});
