import { z } from "zod";

const scalarSchema = z.object({ value: z.number().finite().positive(), literal: z.string().trim().min(1).max(40), quote: z.string().trim().min(1).max(300) }).strict();
export const triangleConstraintsSchema = z.object({
  exact: z.boolean(),
  angles: z.array(scalarSchema.extend({ value: z.number().finite().positive().lt(180) }).strict()).length(3),
  sides: z.array(scalarSchema.extend({ unit: z.string().trim().min(1).max(20).nullable(), oppositeAngleIndex: z.number().int().min(0).max(2).nullable() }).strict()).min(2).max(3),
}).strict();
export type TriangleConstraints = z.infer<typeof triangleConstraintsSchema>;
export type TriangleConstraintResult = { status: "CONSISTENT" | "CONFLICT" | "UNVERIFIED"; reason: string };

// Only validate explicit, quoted typed scalars. This never extracts a figure
// or infers a correspondence from prose, and never evaluates model code.
function groundedScalar(item: z.infer<typeof scalarSchema>, question: string, suffixes: string[] = []): boolean {
  const suffix = suffixes.find((unit) => item.literal.endsWith(unit));
  const numericLiteral = (suffix ? item.literal.slice(0, -suffix.length) : item.literal).trim();
  if (!question.includes(item.quote) || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(numericLiteral) || Number(numericLiteral) !== item.value) return false;
  let from = 0;
  for (;;) {
    const index = item.quote.indexOf(item.literal, from);
    if (index < 0) return false;
    const before = item.quote[index - 1] ?? "";
    const after = item.quote[index + item.literal.length] ?? "";
    if (!/[\d.eE+-]/u.test(before) && !/[\d.eE]/u.test(after)) return true;
    from = index + 1;
  }
}

export function validateTriangleConstraints(constraints: TriangleConstraints, question: string): TriangleConstraintResult {
  if (!constraints.exact) return { status: "UNVERIFIED", reason: "近似数据未提供可验证的误差区间" };
  // Subnormal IEEE-754 values lose relative precision; distinct quoted decimal
  // lengths can round to the same number before any ratio is evaluated.
  if (constraints.sides.some((side) => side.value < 2 ** -1022)) return { status: "UNVERIFIED", reason: "边长处于浮点非正规数范围，无法可靠验证比例" };
  if ([...constraints.angles, ...constraints.sides].some((item) => Number.isInteger(item.value) && !Number.isSafeInteger(item.value)
    || (item.literal.match(/\d/gu)?.length ?? 0) > 16)) return { status: "UNVERIFIED", reason: "数值整数范围或字面量精度超出当前浮点核验范围" };
  if (!constraints.angles.every((item) => groundedScalar(item, question, ["°", "度"]))
    || !constraints.sides.every((item) => groundedScalar(item, question, item.unit ? [item.unit] : []))) return { status: "UNVERIFIED", reason: "提取数值或引用未对应题干" };
  const units = new Set(constraints.sides.map((side) => side.unit));
  if (units.size !== 1 || constraints.sides.some((side) => side.unit !== null && !side.quote.includes(side.unit))) return { status: "UNVERIFIED", reason: "边长单位不同或单位未获引用支持" };
  if (constraints.sides.some((side) => side.oppositeAngleIndex !== null)) {
    // The current extractor cannot provide a machine-checkable proof of named
    // angle/edge correspondence. Do not turn an unverified role into conflict.
    return { status: "UNVERIFIED", reason: "指定边角对应关系尚未独立验证" };
  }
  const sum = constraints.angles.reduce((total, angle) => total + angle.value, 0);
  if (Math.abs(sum - 180) > 1e-8) return { status: "CONFLICT", reason: "完整三个内角的和不等于180度" };
  const sine = constraints.angles.map((angle) => Math.sin(angle.value * Math.PI / 180));
  if (constraints.angles.some((angle) => angle.value < 1e-10 || 180 - angle.value < 1e-10)
    || sine.some((value) => !Number.isFinite(value) || value <= 0)) return { status: "UNVERIFIED", reason: "角度过于接近退化边界，浮点计算无法可靠验证" };
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let nonFiniteScale = false;
  const compatible = permutations.some((order) => {
    const scales = constraints.sides.map((side, index) => side.value / sine[order[index]!]!);
    if (scales.some((scale) => !Number.isFinite(scale) || scale <= 0)) { nonFiniteScale = true; return false; }
    const scale = scales[0]!;
    return scales.every((candidate) => Math.abs(candidate - scale) <= 1e-8 * Math.max(Math.abs(candidate), Math.abs(scale)));
  });
  if (!compatible && nonFiniteScale) return { status: "UNVERIFIED", reason: "边长比例运算超出有限浮点范围" };
  return compatible ? { status: "CONSISTENT", reason: "至少一种未指定边角配对满足同一正弦比例" } : { status: "CONFLICT", reason: "所有边角配对均无法满足同一正弦比例" };
}
