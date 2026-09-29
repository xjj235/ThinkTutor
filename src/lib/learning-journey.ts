import type { LearningReportDTO, MessageDTO } from "./contracts";
import type { LearningFeedback } from "./learning-feedback";

export interface LearningStep {
  question: MessageDTO;
  answer: MessageDTO;
  feedback: LearningFeedback;
  response?: MessageDTO;
  responseStatus: "answered" | "awaiting" | "replaced";
  review?: LearningFeedback;
}

// FEYNMAN is a phase: historical messages may also be recovery verification.
// This type alone never establishes independent work or a change in understanding.
export interface FeynmanStep {
  question: MessageDTO;
  response?: MessageDTO;
  responseStatus: LearningStep["responseStatus"];
  review?: LearningFeedback;
}

export type LearningJourneyStep = (
  | { kind: "feedback"; step: LearningStep }
  | { kind: "feynman"; step: FeynmanStep }
) & { report?: LearningReportDTO };

function taskResponse(messages: readonly MessageDTO[], index: number, phase?: MessageDTO["phase"]) {
  const responseIndex = messages.findIndex((message, nextIndex) => nextIndex > index && message.role === "USER");
  const nextAnswer = responseIndex < 0 ? undefined : messages[responseIndex];
  const replacedTask = messages.slice(index + 1, responseIndex < 0 ? undefined : responseIndex)
    .some((message) => message.role === "ASSISTANT" && message.questionType !== "SCAFFOLDED_HINT")
    || Boolean(phase && nextAnswer && nextAnswer.phase !== phase);
  const response = replacedTask || !nextAnswer?.content.trim() ? undefined : nextAnswer;
  const reviewer = response ? messages.slice(responseIndex + 1).find((message) => message.role === "ASSISTANT" && message.feedbackForMessageId === response.id) : undefined;
  const review = reviewer?.learningFeedback;
  const responseStatus: LearningStep["responseStatus"] = replacedTask ? "replaced" : response ? "answered" : "awaiting";
  return { response, responseStatus, review: review && response?.content.includes(review.answerQuote) ? review : undefined };
}

// Join explicit answer references; answering again does not itself close a gap.
export function learningSteps(messages: readonly MessageDTO[]): LearningStep[] {
  return messages.flatMap((question, index) => {
    if (question.role !== "ASSISTANT" || question.phase === "COMPLETED" || !question.learningFeedback || !question.feedbackForMessageId) return [];
    const answer = messages.slice(0, index).find((message) => message.id === question.feedbackForMessageId && message.role === "USER");
    if (!answer || !answer.content.includes(question.learningFeedback.answerQuote)) return [];
    return [{ question, answer, feedback: question.learningFeedback, ...taskResponse(messages, index) }];
  });
}

// A voluntary or historical FEYNMAN-phase task may have no preceding answer to
// diagnose. Preserve the actual prompt, including recovery prompts, without
// inventing an answer/feedback link or inferring its activity from its wording.
export function feynmanSteps(messages: readonly MessageDTO[]): FeynmanStep[] {
  return messages.flatMap((question, index) => {
    if (question.role !== "ASSISTANT" || question.phase !== "FEYNMAN" || question.questionType === "SCAFFOLDED_HINT"
      || !question.content.trim() || question.learningFeedback || question.feedbackForMessageId) return [];
    return [{ question, ...taskResponse(messages, index, "FEYNMAN") }];
  });
}

export function learningJourneySteps(messages: readonly MessageDTO[], sessionId: string, report?: LearningReportDTO | null): LearningJourneyStep[] {
  const feedbackSteps: LearningJourneyStep[] = learningSteps(messages).map((step) => ({ kind: "feedback", step }));
  const stageSteps: LearningJourneyStep[] = feynmanSteps(messages).map((step) => ({ kind: "feynman", step }));
  const order = new Map(messages.map((message, index) => [message.id, index]));
  const finalAnswer = messages.filter((message) => message.role === "USER").at(-1);
  const finalTask = messages.filter((message) => message.role === "ASSISTANT"
    && message.phase !== "COMPLETED" && message.phase !== "REPORTING" && message.questionType !== "SCAFFOLDED_HINT").at(-1);
  return [...feedbackSteps, ...stageSteps]
    .sort((a, b) => order.get(a.step.question.id)! - order.get(b.step.question.id)!)
    .map((entry) => report?.sessionId === sessionId && finalAnswer?.phase === "FEYNMAN"
      && entry.step.question.phase === "FEYNMAN" && entry.step.question.id === finalTask?.id && entry.step.response?.id === finalAnswer.id
      ? { ...entry, report } : entry);
}
