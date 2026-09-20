import "server-only";

import type { LearnerState, LearningPhase, MessageDTO } from "../contracts";
import { getServerEnv } from "../env";
import { getCourseRetriever } from "../retrieval";
import { StructuredKnowledgeRetriever } from "../retrieval/knowledge-retriever";
import { ReferenceDocumentRetriever } from "../retrieval/reference-retriever";
import { isStudentKnowledgeTaskTopic } from "../knowledge/student-catalog";
import type { KnowledgeRuntime } from "../knowledge/runtime-schemas";

export interface LearningContextInput {
  courseId?: string | null;
  chapterId?: string | null;
  topic: string;
  objective: string;
  latestAnswer?: string;
  contextSummary?: string | null;
  phase?: LearningPhase;
  learnerState?: LearnerState | null;
  knowledgeRuntime?: KnowledgeRuntime | null;
  selectedAction?: import("../knowledge/orchestrator").KnowledgeAction | null;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
}

export type KnowledgePolicy = "COURSE_KNOWLEDGE_FIRST" | "MODEL_FALLBACK";

export async function buildLearningContext(input: LearningContextInput) {
  const env = getServerEnv();
  const recentMessages = input.messages.slice(-env.AI_RECENT_MESSAGE_LIMIT);
  const errorTags = input.learnerState?.misconceptions.filter((item) => item.startsWith("ERR_")) ?? [];
  const targetConcept = input.selectedAction?.targetId ?? input.knowledgeRuntime?.currentTargetId ?? input.learnerState?.gaps.find((item) => /^(KU_|C_SR_|M_SR_|D_SR_)/u.test(item));
  const retrievalQuery = {
      courseId: input.courseId ?? "curated-public",
      chapterId: input.chapterId ?? undefined,
      query: `${input.topic} ${input.objective} ${input.latestAnswer ?? ""}`,
      subject: isStudentKnowledgeTaskTopic(input.topic) ? input.topic : `${input.topic} ${input.objective}`,
      limit: env.AI_RETRIEVAL_CHUNK_LIMIT,
      phase: input.phase,
      targetConcept,
      errorTags,
      usedQuestionIds: input.knowledgeRuntime?.usedQuestionIds,
      usedCaseIds: input.knowledgeRuntime?.usedCaseIds,
      releaseId: input.knowledgeRuntime?.versions.releaseId,
      selectedQuestionId: input.selectedAction?.questionId,
      selectedCaseId: input.selectedAction?.caseId ?? undefined,
      hintLevel: input.selectedAction?.hintLevel,
    };
  const [existing, reference] = await Promise.all([
    (input.courseId ? getCourseRetriever() : new StructuredKnowledgeRetriever()).retrieve(retrievalQuery),
    new ReferenceDocumentRetriever().retrieve({ ...retrievalQuery, topic: input.topic, objective: input.objective }),
  ]);
  const retrieved = [...existing.slice(0, Math.max(0, env.AI_RETRIEVAL_CHUNK_LIMIT - reference.length)), ...reference]
    .slice(0, env.AI_RETRIEVAL_CHUNK_LIMIT);
  let used = input.contextSummary?.length ?? 0;
  const retrievedContext: string[] = [];
  for (const chunk of retrieved) {
    if (used + chunk.content.length > env.AI_CONTEXT_MAX_CHARS) continue;
    retrievedContext.push(chunk.content);
    used += chunk.content.length;
  }
  return {
    recentMessages,
    retrievedContext,
    contextSummary: input.contextSummary ?? null,
    knowledgePolicy: retrievedContext.length > 0 ? "COURSE_KNOWLEDGE_FIRST" as const : "MODEL_FALLBACK" as const,
  };
}
