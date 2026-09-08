import "server-only";
import { getAIProvider } from "../ai";
import type { AIRequestMeta } from "../ai/types";
import { createTeachingDecisionSchema } from "../ai/teaching-schema";
import { withAIRequestProtection } from "../request-limits";
import { AppError } from "../errors";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { KnowledgeManifest } from "./schemas";
import { prepareCoaching, type CoachingOptions } from "./coaching";

export async function selectCoaching(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, options: CoachingOptions, meta: AIRequestMeta & { userId: string; requestId: string }, protectionKey: string) {
  const prepared = prepareCoaching(manifest, runtime, options);
  const raw = await withAIRequestProtection(meta.userId, protectionKey, () => getAIProvider().selectTeachingMove({ ...prepared.input, ...meta }), prepared.input.grounding ? 2 : 1);
  const decision = createTeachingDecisionSchema(prepared.input).safeParse(raw);
  if (!decision.success) throw new AppError("AI_INVALID_OUTPUT", "教学策略未通过知识库约束校验，请重试。", 502, true);
  return { prepared, decision: decision.data };
}
