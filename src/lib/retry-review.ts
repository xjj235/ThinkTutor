import { z } from "zod";

export const RETRY_REVIEW_MESSAGE_LIMIT = 40;

const reviewGapSchema = z.object({
  title: z.string().trim().min(1).max(180),
  evidence: z.string().trim().min(1).max(600),
  repairTask: z.string().trim().min(1).max(400),
}).strict();

// This input is assembled from the owned retry session on the server. In
// particular, a student must never supply message IDs or the independent flag.
export const retryReviewInputSchema = z.object({
  sourceGap: reviewGapSchema.extend({ id: z.string().min(1).max(64) }).strict(),
  messages: z.array(z.object({
    id: z.string().min(1).max(64),
    role: z.literal("USER"),
    phase: z.enum(["DIAGNOSIS", "SOCRATIC", "FEYNMAN", "REPORTING", "COMPLETED", "ABANDONED"]),
    content: z.string().min(1),
    isIndependentExplanation: z.boolean().optional(),
  }).strict()).max(RETRY_REVIEW_MESSAGE_LIMIT),
  report: z.object({
    summary: z.string().trim().min(1).max(1_000),
    gaps: z.array(reviewGapSchema.extend({ priority: z.number().int().min(1).max(5) }).strict()).max(5),
  }).strict(),
  resolutionBlockedReason: z.string().trim().min(1).max(600).optional(),
}).strict();

export const retryReviewEvidenceSchema = z.object({
  messageId: z.string().min(1).max(64),
  // Do not trim or normalize quotations: provenance requires the exact text.
  quote: z.string().min(1).max(600),
}).strict();

export const retryReviewCandidateSchema = z.object({
  verdict: z.enum(["RESOLVED", "STILL_OPEN", "INSUFFICIENT_EVIDENCE"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(600),
  evidence: z.array(retryReviewEvidenceSchema).max(4),
}).strict();

export const retryReviewSchema = retryReviewCandidateSchema.extend({
  sourceGapId: z.string().min(1).max(64),
  status: z.enum(["OPEN", "RESOLVED"]),
  reviewedAt: z.iso.datetime(),
}).strict().superRefine((review, context) => {
  if ((review.verdict === "RESOLVED") !== (review.status === "RESOLVED")) {
    context.addIssue({ code: "custom", path: ["status"], message: "Repair status must match the reviewed verdict." });
  }
});

export type RetryReviewInput = z.infer<typeof retryReviewInputSchema>;
export type RetryReviewCandidate = z.infer<typeof retryReviewCandidateSchema>;
export type RetryReview = z.infer<typeof retryReviewSchema>;

function substantiveText(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

/** Model output is advisory; only this server-side check can resolve a gap. */
export function finalizeRetryReview(candidate: unknown, rawInput: RetryReviewInput, reviewedAt: string): RetryReview {
  const input = retryReviewInputSchema.parse(rawInput);
  const parsed = retryReviewCandidateSchema.safeParse(candidate);
  const base = { sourceGapId: input.sourceGap.id, reviewedAt };
  const insufficient = (rationale: string, evidence: RetryReviewCandidate["evidence"] = [], confidence = 0): RetryReview =>
    retryReviewSchema.parse({ ...base, verdict: "INSUFFICIENT_EVIDENCE", status: "OPEN", confidence, rationale, evidence });
  if (!parsed.success) throw new Error("修复复核结果不符合结构约束。");

  const review = parsed.data;
  const messages = new Map(input.messages.map((message) => [message.id, message]));
  const evidence = review.evidence.filter((item) => messages.get(item.messageId)?.content.includes(item.quote));
  if (messages.size !== input.messages.length || evidence.length !== review.evidence.length) {
    throw new Error("修复复核引用未能唯一对应本次学生原文。");
  }
  if (review.verdict !== "RESOLVED") {
    return retryReviewSchema.parse({ ...base, ...review, status: "OPEN" });
  }
  if (input.resolutionBlockedReason) {
    return insufficient(input.resolutionBlockedReason, evidence, review.confidence);
  }
  if (review.confidence < 0.75) {
    return insufficient("针对原知识漏洞的复核信心不足，需要补充证据后继续验证。", evidence, review.confidence);
  }

  const substantialEvidence = evidence.filter((item) => substantiveText(item.quote).length >= 12);
  const distinctMessages = new Set(substantialEvidence.map((item) => item.messageId));
  const distinctQuotes = new Set(substantialEvidence.map((item) => substantiveText(item.quote)));
  const independentExplanation = substantialEvidence.some((item) => {
    const message = messages.get(item.messageId);
    return message?.phase === "FEYNMAN" && message.isIndependentExplanation === true;
  });
  if (distinctMessages.size < 2 || distinctQuotes.size < 2 || !independentExplanation) {
    return insufficient("至少需要两次不同学生表达的实质证据，其中一次为独立费曼讲解；仅有反思或重复表述尚不足以确认修复。", evidence, review.confidence);
  }
  return retryReviewSchema.parse({ ...base, ...review, status: "RESOLVED" });
}
