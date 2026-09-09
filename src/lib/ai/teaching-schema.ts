import { z } from "zod";
import { coachingDecisionSchema, coachingKindSchema, coachingProfileSchema, generatedFollowUpSchema, type CoachingDecision } from "../knowledge/coaching-schema";

const ids = z.array(z.string().min(1)).max(80);
const groundingSchema = z.object({
  targetId: z.string(), targetTitle: z.string(),
  requirements: z.object({ requiredAll: ids, requiredAny: ids, prohibited: ids }).strict(),
  sources: z.array(z.object({ id: z.string(), text: z.string().max(8000) }).strict()).min(1).max(40),
  instructions: z.array(z.string()).max(12), maxQuestionChars: z.number().int().min(120).max(500),
}).strict();
export const teachingReviewSchema = z.object({
  grounded: z.boolean(), targetAligned: z.boolean(), answerConnected: z.boolean(), nonRedundant: z.boolean(), noAnswerLeak: z.boolean(),
}).strict();

export const teachingSelectionInputSchema = z.object({
  kind: coachingKindSchema,
  profile: coachingProfileSchema,
  standard: z.string().max(1200),
  choices: z.array(z.object({ id: z.string(), purpose: z.string(), template: z.string().max(8000) }).strict()).min(1).max(8),
  openings: z.array(z.object({ id: z.string(), text: z.string() }).strict()).min(1).max(6),
  studentContent: z.string(),
  grounding: groundingSchema.optional(),
  recentTurns: z.array(z.object({ role: z.enum(["USER", "ASSISTANT"]), content: z.string().max(2000) }).strict()).max(8).optional(),
  previousQuestions: z.array(z.string().max(8000)).max(8).optional(),
}).strict();
export type TeachingSelection = z.infer<typeof teachingSelectionInputSchema>;
export type TeachingOutput = Omit<CoachingDecision, "followUp"> & { followUp?: Omit<NonNullable<CoachingDecision["followUp"]>, "focusEvidenceIds"> };

const normalizeQuestion = (text: string) => text.normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "").toLowerCase();

export function createTeachingOutputSchema(input: TeachingSelection): z.ZodType<TeachingOutput> {
  const parsed = teachingSelectionInputSchema.parse(input);
  const grounding = parsed.grounding;
  const selectionSchema = coachingDecisionSchema.omit({ followUp: true }).extend({ choiceId: z.enum(parsed.choices.map((c) => c.id)), openingId: z.enum(parsed.openings.map((c) => c.id)) }).strict();
  if (!grounding) return selectionSchema;
  const followUp = generatedFollowUpSchema.omit({ focusEvidenceIds: true }).extend({
    question: generatedFollowUpSchema.shape.question.max(grounding.maxQuestionChars),
    sourceIds: z.array(z.enum(grounding.sources.map((s) => s.id))).min(1).max(8),
  });
  return selectionSchema.extend({ followUp }).strict().superRefine((decision, context) => {
    const generated = decision.followUp;
    if (!generated || !grounding) return;
    const issue = (field: string, message: string) => context.addIssue({ code: "custom", path: ["followUp", field], message });
    if (!parsed.studentContent.includes(generated.studentAnchor) || !generated.question.includes(generated.studentAnchor)) issue("studentAnchor", "Anchor must be a verbatim part of this answer and of the question.");
    if ((generated.question.match(/[?？]/gu) ?? []).length !== 1 || !/[?？]$/u.test(generated.question)) issue("question", "End with exactly one question; no additional tasks.");
    if (/https?:\/\/|[<>]|```|\{content\}|(?:^|\n)\s*(?:\d+[.)、]|[-*])\s/u.test(generated.question)) issue("question", "No links, markup, placeholders or task lists.");
    if (new Set(generated.sourceIds).size !== generated.sourceIds.length) issue("sourceIds", "References must be unique.");
    if (parsed.previousQuestions?.some((q) => normalizeQuestion(q) === normalizeQuestion(generated.question))) issue("question", "Do not repeat a previous question.");
  });
}

export function attachTeachingScope(input: TeachingSelection, output: TeachingOutput): CoachingDecision {
  return { choiceId: output.choiceId, openingId: output.openingId, ...(output.followUp && input.grounding ? { followUp: {
    ...output.followUp,
    focusEvidenceIds: [...new Set([...input.grounding.requirements.requiredAll, ...input.grounding.requirements.requiredAny])],
  } } : {}) };
}

export function createTeachingDecisionSchema(input: TeachingSelection): z.ZodType<CoachingDecision> {
  const wireSchema = createTeachingOutputSchema(input);
  if (!input.grounding) return coachingDecisionSchema.omit({ followUp: true }).extend({ choiceId: z.enum(input.choices.map((c) => c.id)), openingId: z.enum(input.openings.map((c) => c.id)) }).strict();
  return coachingDecisionSchema.superRefine((decision, context) => {
    const wire = { choiceId: decision.choiceId, openingId: decision.openingId, ...(decision.followUp ? { followUp: { question: decision.followUp.question, studentAnchor: decision.followUp.studentAnchor, sourceIds: decision.followUp.sourceIds } } : {}) };
    const checked = wireSchema.safeParse(wire);
    if (!checked.success) { checked.error.issues.forEach((issue) => context.addIssue({ code: "custom", path: issue.path, message: issue.message })); return; }
    const expected = attachTeachingScope(input, checked.data);
    if (JSON.stringify(decision.followUp?.focusEvidenceIds) !== JSON.stringify(expected.followUp?.focusEvidenceIds)) context.addIssue({ code: "custom", path: ["followUp", "focusEvidenceIds"], message: "Evidence scope is owned by the server, not the model." });
  });
}
