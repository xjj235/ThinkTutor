import { z } from "zod";
import type { LearningReportDraft } from "../contracts";

export const reportEvidenceLinksSchema = z.object({
  conceptCompleteness: z.array(z.string()).max(40),
  logicCompleteness: z.array(z.string()).max(40),
  expressionClarity: z.array(z.string()).max(40),
  exampleAbility: z.array(z.string()).max(40),
  transferAbility: z.array(z.string()).max(40),
}).strict();
export type ReportEvidenceLinks = z.infer<typeof reportEvidenceLinksSchema>;

// Only literal quotations can be linked automatically; paraphrases remain unlinked.
export function linkReportEvidence(draft: Pick<LearningReportDraft, "dimensions">, messages: Array<{ id: string; role: string; content: string }>): ReportEvidenceLinks {
  const links: ReportEvidenceLinks = { conceptCompleteness: [], logicCompleteness: [], expressionClarity: [], exampleAbility: [], transferAbility: [] };
  for (const key of Object.keys(links) as Array<keyof ReportEvidenceLinks>) {
    const quotes = [...draft.dimensions[key].evidence.matchAll(/[“「"]([^”」"\r\n]{2,600})[”」"]/gu)].map((match) => match[1]);
    links[key] = messages.filter((message) => message.role === "USER" && quotes.some((quote) => message.content.includes(quote))).map((message) => message.id);
  }
  return reportEvidenceLinksSchema.parse(links);
}
