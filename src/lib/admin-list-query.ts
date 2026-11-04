import { AIUsageStatus, AuditAction, MaterialStatus } from "@prisma/client";
import { z } from "zod";
import { firstSearchValue, type SearchParams } from "./list-query";

const optionalText = <T extends z.ZodType<string>>(schema: T) => z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  schema.optional(),
);
const date = optionalText(z.iso.date().regex(/^[1-9]/u));
const base = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  query: optionalText(z.string().trim().max(120)),
  from: date,
  to: date,
});
const validRange = (value: { from?: string; to?: string }) => !value.from || !value.to || value.from <= value.to;
const rangeError = { message: "开始日期不能晚于结束日期。", path: ["from"] };

export const aiUsageListSchema = base.extend({
  status: optionalText(z.enum(AIUsageStatus)),
  operation: optionalText(z.string().trim().max(80)),
}).refine(validRange, rangeError);
export const materialJobListSchema = base.extend({
  status: optionalText(z.enum(MaterialStatus)),
}).refine(validRange, rangeError);
export const auditLogListSchema = base.extend({
  action: optionalText(z.enum(AuditAction)),
}).refine(validRange, rangeError);

export type AIUsageListQuery = z.infer<typeof aiUsageListSchema>;
export type MaterialJobListQuery = z.infer<typeof materialJobListSchema>;
export type AuditLogListQuery = z.infer<typeof auditLogListSchema>;

export function adminSearchValues(parameters: SearchParams): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, firstSearchValue(value)]));
}

/** Dates in the HTML filters are Beijing calendar dates, including the entire end day. */
export function adminDateRange(input: { from?: string; to?: string }) {
  return {
    ...(input.from ? { gte: new Date(`${input.from}T00:00:00+08:00`) } : {}),
    ...(input.to ? { lt: new Date(new Date(`${input.to}T00:00:00+08:00`).getTime() + 86_400_000) } : {}),
  };
}
