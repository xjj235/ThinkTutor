import { describe, expect, it } from "vitest";
import { learningEntryDestination } from "@/lib/auth/learning-entry";

describe("student home authentication continuation", () => {
  it("permits only the existing task creation route", () => {
    expect(learningEntryDestination("/learn/new")).toBe("/learn/new");
    for (const candidate of [undefined, null, "", "/admin", "/teacher", "https://example.org", "//example.org", "javascript:alert(1)", "/learn/new?next=https://example.org", ["/learn/new"], "/learn/new/../admin"]) {
      expect(learningEntryDestination(candidate)).toBeUndefined();
    }
  });
});
