import "server-only";

import type { MessageDTO } from "../contracts";
import { getServerEnv } from "../env";
import { getCourseRetriever } from "../retrieval";

export interface LearningContextInput {
  courseId?: string | null;
  chapterId?: string | null;
  topic: string;
  objective: string;
  latestAnswer?: string;
  contextSummary?: string | null;
  messages: Pick<MessageDTO, "role" | "phase" | "content" | "questionType">[];
}

export async function buildLearningContext(input: LearningContextInput) {
  const env = getServerEnv();
  const recentMessages = input.messages.slice(-env.AI_RECENT_MESSAGE_LIMIT);
  const retrieved = input.courseId
    ? await getCourseRetriever().retrieve({ courseId: input.courseId, chapterId: input.chapterId ?? undefined, query: `${input.topic} ${input.objective} ${input.latestAnswer ?? ""}`, limit: env.AI_RETRIEVAL_CHUNK_LIMIT })
    : [];
  let used = input.contextSummary?.length ?? 0;
  const retrievedContext: string[] = [];
  for (const chunk of retrieved) {
    if (used + chunk.content.length > env.AI_CONTEXT_MAX_CHARS) break;
    retrievedContext.push(chunk.content);
    used += chunk.content.length;
  }
  return { recentMessages, retrievedContext, contextSummary: input.contextSummary ?? null };
}
