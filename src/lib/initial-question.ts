import { diagnosticQuestionSchema } from "./contracts";
import type { SourcedDiagnosticQuestion } from "./ai/types";

/**
 * Ordinary sessions begin by collecting the student's own account.
 * Deliberately accepts no task, reference, or prior report: none of those is
 * evidence of what this student currently understands in the new session.
 */
export function buildInitialSelfExplanation(): SourcedDiagnosticQuestion {
  return diagnosticQuestionSchema.parse({
    assistantMessage: "如果暂时说不清，也可以直接说“不知道”。先用自己的话说说：关于这个知识点，你现在认为最重要的一点是什么？",
    questionType: "CONCEPT_CLARIFICATION",
    learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] },
    nextAction: "ASK_QUESTION",
    transitionReason: "等待首次自述，再根据学生实际回答诊断并追问。",
  });
}
