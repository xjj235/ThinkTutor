import { describe, expect, it } from "vitest";
import { triangleConstraintsSchema, validateTriangleConstraints } from "@/lib/ai/triangle-constraints";

function fixture(angles: number[], sides: number[]) {
  const question = `三个角${angles.join("、")}度，两边${sides.join("、")}厘米`;
  return { question, value: triangleConstraintsSchema.parse({ exact: true, angles: angles.map((value) => ({ value, literal: String(value), quote: question })), sides: sides.map((value) => ({ value, literal: String(value), quote: question, unit: "厘米", oppositeAngleIndex: null })) }) };
}
describe("bounded quoted triangle constraints", () => {
  it.each([
    { angles: [50, 60, 70], sides: [3, 4], expected: "CONFLICT" },
    { angles: [60, 60, 60], sides: [3, 3], expected: "CONSISTENT" },
    { angles: [30, 60, 90], sides: [3, 6], expected: "CONSISTENT" },
    { angles: [30, 60, 90], sides: [6, 3], expected: "CONSISTENT" },
    { angles: [20, 60, 90], sides: [3, 6], expected: "CONFLICT" },
    { angles: [50, 60, 70], sides: [3e-10, 4e-10], expected: "CONFLICT" },
    { angles: [50, 60, 70], sides: [3e10, 4e10], expected: "CONFLICT" },
    { angles: [50, 60, 70], sides: [3e100, 4e100], expected: "UNVERIFIED" },
    { angles: [60, 60, 60], sides: [3e-10, 3e-10], expected: "CONSISTENT" },
    { angles: [50, 60, 70], sides: [3e-324, 4e-324], expected: "UNVERIFIED" },
    { angles: [30, 60, 90], sides: [1e308, 1.5e308], expected: "UNVERIFIED" },
    { angles: [1e-12, 90, 89.999999999999], sides: [3, 4], expected: "UNVERIFIED" },
  ])("checks exact angle/side combinations $angles / $sides", ({ angles, sides, expected }) => {
    const data = fixture(angles, sides);
    expect(validateTriangleConstraints(data.value, data.question).status).toBe(expected);
  });
  it("does not label approximation, missing citations, or differing units as a proven conflict", () => {
    const data = fixture([50, 60, 70], [3, 4]);
    expect(validateTriangleConstraints({ ...data.value, exact: false }, data.question).status).toBe("UNVERIFIED");
    expect(validateTriangleConstraints(data.value, "没有这些题设").status).toBe("UNVERIFIED");
    const changed = structuredClone(data.value);
    changed.sides[0]!.unit = "米";
    expect(validateTriangleConstraints(changed, data.question).status).toBe("UNVERIFIED");
  });
  it("does not treat a digit inside a different number or unverified role as a quoted value", () => {
    const data = fixture([30, 60, 90], [3, 6]);
    data.value.sides[0]!.quote = "三个角30、60、90度";
    expect(validateTriangleConstraints(data.value, data.question).status).toBe("UNVERIFIED");
    const role = fixture([30, 60, 90], [3, 6]);
    role.value.sides[0]!.oppositeAngleIndex = 2;
    expect(validateTriangleConstraints(role.value, role.question).status).toBe("UNVERIFIED");
  });
  it("accepts quoted degree suffixes without interpreting unstructured math", () => {
    const data = fixture([60, 60, 60], [3, 3]);
    data.question = "三个角均为60°，两条边均长3厘米";
    for (const angle of data.value.angles) { angle.literal = "60°"; angle.quote = "三个角均为60°"; }
    for (const side of data.value.sides) { side.literal = "3厘米"; side.quote = "两条边均长3厘米"; }
    expect(validateTriangleConstraints(data.value, data.question).status).toBe("CONSISTENT");
  });
  it("does not treat a rounded long decimal literal as exact input", () => {
    const data = fixture([60, 60, 60], [3, 3]);
    const literal = "3.00000000000000000001";
    data.question = `三个角60度，两边${literal}和3厘米`;
    for (const angle of data.value.angles) angle.quote = "三个角60度";
    data.value.sides[0]!.literal = literal;
    for (const side of data.value.sides) side.quote = data.question;
    expect(validateTriangleConstraints(data.value, data.question).status).toBe("UNVERIFIED");
  });
});
