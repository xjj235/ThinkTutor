import "server-only";

import { z } from "zod";
import exchangeRateRisk from "../../../knowledge/courses/financial-risk-management/reference-library/exchange-rate-risk.json";
import economicCycleRisk from "../../../knowledge/courses/financial-risk-management/reference-library/economic-cycle-risk.json";
import interestRateRisk from "../../../knowledge/courses/financial-risk-management/reference-library/interest-rate-risk.json";
import inflationRisk from "../../../knowledge/courses/financial-risk-management/reference-library/inflation-risk.json";
import policyRisk from "../../../knowledge/courses/financial-risk-management/reference-library/policy-risk.json";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const blockSchema = z.object({
  locator: z.string().regex(/^(paragraph:\d+|table:\d+\/row:\d+)$/u),
  section: z.string().min(1),
  text: z.string().min(1),
}).strict();

export const referenceDocumentSchema = z.object({
  id: z.string().regex(/^[a-z-]+-0[1-8]$/u),
  order: z.number().int().min(1).max(8),
  title: z.string().min(1),
  fileName: z.string().endsWith(".docx"),
  sourcePath: z.string().regex(/^sources\/[a-z-]+\/0[1-8]\.docx$/u),
  sha256: checksumSchema,
  textSha256: checksumSchema,
  blocks: z.array(blockSchema).min(1),
}).strict();

export const referenceTopicSchema = z.object({
  id: z.string().regex(/^[a-z-]+$/u),
  title: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1),
  version: z.literal("1.2.1"),
  status: z.literal("reference"),
  instructionPolicy: z.literal("untrusted-reference-only"),
  archive: z.object({ fileName: z.string().endsWith(".zip"), sha256: checksumSchema }).strict(),
  documents: z.array(referenceDocumentSchema).length(8),
}).strict().superRefine((topic, context) => {
  for (const [index, document] of topic.documents.entries()) {
    const order = String(index + 1).padStart(2, "0");
    if (document.order !== index + 1 || document.id !== `${topic.id}-${order}` || document.sourcePath !== `sources/${topic.id}/${order}.docx`) {
      context.addIssue({ code: "custom", message: "Document identity/order/source mismatch", path: ["documents", index] });
    }
    if (new Set(document.blocks.map((block) => block.locator)).size !== document.blocks.length) {
      context.addIssue({ code: "custom", message: "Duplicate source locator", path: ["documents", index, "blocks"] });
    }
  }
});

export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;
export type ReferenceTopic = z.infer<typeof referenceTopicSchema>;

// Source documents are not executable manifests or reviewed releases.
export const referenceTopics = z.array(referenceTopicSchema).length(5).parse([
  exchangeRateRisk, economicCycleRisk, interestRateRisk, inflationRisk, policyRisk,
]);

export interface ReferenceKnowledgeUnit {
  id: string;
  topicId: string;
  documentId: string;
  locator: string;
  title: string;
  content: string;
}

// Only subject knowledge enters learning context. Full documents, including
// prompts, answer keys and routing specifications, remain in the teacher library.
export const referenceKnowledgeUnits: ReferenceKnowledgeUnit[] = referenceTopics.flatMap((topic) => {
  const document = topic.documents[0];
  return document.blocks.filter((block) => /^table:2\/row:[2-9]$/u.test(block.locator)).map((block) => {
    const [id, title, content] = block.text.split(" | ");
    if (!id || !title || !content || !/^[A-Z]+_[A-Z]+_\d+$/u.test(id)) throw new Error(`Invalid reference knowledge unit: ${document.id}@${block.locator}`);
    return { id, topicId: topic.id, documentId: document.id, locator: block.locator, title, content };
  });
});

if (referenceKnowledgeUnits.length !== 40 || new Set(referenceKnowledgeUnits.map((unit) => unit.id)).size !== 40) {
  throw new Error("Expected forty unique imported knowledge units");
}
