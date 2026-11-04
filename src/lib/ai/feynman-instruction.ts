import type { CreateSessionInput } from "../contracts";
import { feynmanInstructionSchema } from "./schemas";

// This is a phase instruction, not a model assessment. Keep it independent of
// generated mastery summaries and reference answers so the learner supplies
// the explanation. Both providers use the same browser workflow and contract.
export function createFeynmanTaskInstruction(task: Pick<CreateSessionInput, "topic">) {
  const topic = task.topic.replace(/[\r\n?？]/gu, " ").trim() || "这个知识点";
  return feynmanInstructionSchema.parse({
    assistantMessage: `请把“${topic}”讲给一位第一次接触它的同学听。请独立组织自己的解释，并说明仍不确定的地方。`,
    requirements: [
      "用自己的话说明核心概念",
      "解释你的判断、推理过程和依据",
      "自选一个例子，说明它与概念的对应关系",
      "说明适用条件、边界，以及仍不确定的地方",
    ],
  });
}
