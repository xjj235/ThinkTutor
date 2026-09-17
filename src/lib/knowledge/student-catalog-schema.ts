import { z } from "zod";

export const knowledgeSelectionSchema = z.object({
  topicId: z.string().trim().min(2).max(80),
  unitId: z.string().trim().min(2).max(80).optional(),
}).strict();

export const studentKnowledgeTopicSchema = z.object({
  id: z.string().min(2).max(80),
  title: z.string().min(1).max(120),
  objective: z.string().min(1).max(400),
  units: z.array(z.object({
    id: z.string().min(2).max(80),
    title: z.string().min(1).max(100),
    objective: z.string().min(1).max(400),
  }).strict()).min(1),
}).strict();

export type KnowledgeSelection = z.infer<typeof knowledgeSelectionSchema>;
export type StudentKnowledgeTopic = z.infer<typeof studentKnowledgeTopicSchema>;
