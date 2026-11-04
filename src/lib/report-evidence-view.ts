import type { DimensionKey, LearningReportDTO, MessageDTO } from "./contracts";

/** Locate a report citation, without treating a quotation as proof of mastery. */
export function reportDimensionSources(
  report: Pick<LearningReportDTO, "dimensions" | "evidenceLinks">,
  key: DimensionKey,
  messages: readonly MessageDTO[],
): MessageDTO[] {
  const quotes = [...report.dimensions[key].evidence.matchAll(/[“「"]([^”」"\r\n]{2,600})[”」"]/gu)].map((match) => match[1]);
  const linkedIds = report.evidenceLinks?.[key];
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (message.role !== "USER" || seen.has(message.id)) return false;
    if (linkedIds && !linkedIds.includes(message.id)) return false;
    if (!quotes.some((quote) => message.content.includes(quote))) return false;
    seen.add(message.id);
    return true;
  });
}
