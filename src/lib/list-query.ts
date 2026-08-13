import { z } from "zod";

export type SearchParams = Record<string, string | string[] | undefined>;

export function firstSearchValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePage(value: string | string[] | undefined): number {
  return z.coerce.number().int().min(1).max(10_000).catch(1).parse(firstSearchValue(value));
}

export function cleanSearch(value: string | string[] | undefined): string | undefined {
  const parsed = z.string().trim().max(120).catch("").parse(firstSearchValue(value));
  return parsed || undefined;
}
