import {
  CoachTurn,
  DiagnosticQuestion,
  LearningReportDraft,
  QuestionType,
  reportDisclaimer,
  coachTurnSchema,
  diagnosticQuestionSchema,
  learningReportDraftSchema,
} from "../contracts";
import { isLowInformationAnswer } from "../state-machine";
import { requireAnswerFeedback } from "./coach-feedback";
import type { LearningFeedback } from "../learning-feedback";
import { retryReviewCandidateSchema, retryReviewInputSchema, type RetryReviewInput } from "../retry-review";
import { mockAssessLearningTurn } from "./mock-assessment-v12";
import type { TurnAssessmentInput } from "./types";
import type {
  AIProvider,
  AIRequestMeta,
  CoachTurnInput,
  ContextSummaryInput,
  DiagnosticInput,
  FeynmanInstructionInput,
  MaterialKeywordsInput,
  ReportInput,
  RetryTaskInput,
} from "./types";
import {
  feynmanInstructionSchema,
  learningContextSummarySchema,
  materialKeywordsSchema,
  retryTaskSchema,
} from "./schemas";

function topicLabel(topic: string) {
  return topic.replace(/[\r\n?？]/g, " ").trim() || "这个知识点";
}
function quoteEvidence(text: string, matcher: (segment: string) => boolean): string {
  const segment = text.split(/[\r\n。！？!?]+/u).map((item) => item.trim()).find(matcher) ?? text.trim();
  return `学生在本次对话中写道：“${segment.slice(0, 180)}”。`;
}


function supportQuestion(input: CoachTurnInput): CoachTurn {
  const topic = topicLabel(input.task.topic);
  const level = Math.min(input.unknownStreak, 3);

  if (level <= 1) {
    return coachTurnSchema.parse({
      assistantMessage: `先把范围缩小：在“${topic}”里，你最能确定的一个关键词或现象是什么？`,
      questionType: "SCAFFOLDED_HINT",
      learnerState: input.learnerState ?? { masteryEstimate: 0, confirmedPoints: [], gaps: [topic], misconceptions: [] },
      nextAction: "ASK_QUESTION",
      transitionReason: "学生需要缩小问题范围。",
    });
  }

  if (level === 2) {
    return coachTurnSchema.parse({
      assistantMessage: `给你一个二选一框架：你认为“${topic}”更像是概念之间的关系问题，还是条件变化导致的结果问题？`,
      questionType: "SCAFFOLDED_HINT",
      learnerState: input.learnerState ?? { masteryEstimate: 0, confirmedPoints: [], gaps: [topic], misconceptions: [] },
      nextAction: "ASK_QUESTION",
      transitionReason: "学生需要二选一支架。",
    });
  }

  return coachTurnSchema.parse({
    assistantMessage: `最小必要原理是先找核心概念、再说明条件和结果；你能用这三步解释“${topic}”吗？`,
    questionType: "SCAFFOLDED_HINT",
    learnerState: input.learnerState ?? { masteryEstimate: 0, confirmedPoints: [], gaps: [topic], misconceptions: [] },
    nextAction: "ASK_QUESTION",
    transitionReason: "学生需要最小必要原理。",
  });
}

export class MockAIProvider implements AIProvider {
  async assessGapRepair(input: RetryReviewInput & AIRequestMeta) {
    retryReviewInputSchema.parse({ sourceGap: input.sourceGap, messages: input.messages, report: input.report, resolutionBlockedReason: input.resolutionBlockedReason });
    return retryReviewCandidateSchema.parse({
      verdict: "INSUFFICIENT_EVIDENCE",
      confidence: 0,
      rationale: "演示模型未进行针对原知识漏洞的实质复核，暂不能确认修复；请继续补充独立讲解与迁移证据。",
      evidence: [],
    });
  }
  async selectTeachingMove(input: import("./teaching-schema").TeachingSelection) {
    const studentAnchor = input.studentContent.match(/[^?？\r\n]{1,30}/u)?.[0].trim() ?? "";
    return { choiceId: input.choices[0].id, openingId: input.openings[0].id, ...(input.grounding ? { followUp: {
      question: `你提到“${studentAnchor}”，${input.choices[0].template}`,
      studentAnchor,
      focusEvidenceIds: [...new Set([...input.grounding.requirements.requiredAll, ...input.grounding.requirements.requiredAny])],
      sourceIds: [input.grounding.sources[0].id],
    } } : {}) };
  }
  async assessLearningTurn(input: TurnAssessmentInput) { return mockAssessLearningTurn(input); }
  async createDiagnosticQuestion(
    input: DiagnosticInput,
  ): Promise<DiagnosticQuestion> {
    const topic = topicLabel(input.task.topic);
    return diagnosticQuestionSchema.parse({
      assistantMessage: `在开始前，你现在如何理解“${topic}”？`,
      questionType: "CONCEPT_CLARIFICATION",
      learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [topic], misconceptions: [] },
      nextAction: "ASK_QUESTION",
      transitionReason: "需要先确认学生的当前理解。",
    });
  }

  async createCoachTurn(input: CoachTurnInput): Promise<CoachTurn> {
    if (input.isHintRequest) {
      return supportQuestion(input);
    }
    const latestAnswer = input.latestAnswer ?? "";
    const topic = topicLabel(input.task.topic);
    const studentText = [...input.messages.filter((message) => message.role === "USER").map((message) => message.content), latestAnswer].join("\n");
    const lowInformation = isLowInformationAnswer(latestAnswer);
    // These markers choose a demonstrable exercise, never certify subject mastery.
    const questionType: QuestionType = lowInformation ? "SCAFFOLDED_HINT"
      : !/是|指|意思|定义/.test(studentText) ? "CONCEPT_CLARIFICATION"
        : !/因为|所以|导致|因此|通过|使/.test(studentText) ? "CAUSE_PROBE"
          : !/如果|前提|条件|只有|当/.test(studentText) ? "ASSUMPTION_TEST"
            : !/证据|数据|观察|合同|记录/.test(studentText) ? "EVIDENCE_PROBE"
              : !/例如|比如|场景|案例/.test(studentText) ? "TRANSFER" : "COUNTEREXAMPLE";
    const moves: Record<QuestionType, { question: string; focus: string; why: string }> = {
      CONCEPT_CLARIFICATION: { question: `你刚才使用的说法中，“${topic}”的核心含义是什么？`, focus: `用自己的话界定“${topic}”的核心含义。`, why: "先确定概念所指，才能检查后面的原因和例子是否在解释同一件事。" },
      CAUSE_PROBE: { question: "你刚才描述的现象是通过哪一个关键环节影响结果的？", focus: "补充你所描述的现象与结果之间的一个因果环节。", why: "只说现象与结果同时出现，还不能解释为什么前者会带来后者。" },
      ASSUMPTION_TEST: { question: "你刚才的判断需要什么条件才能成立？", focus: "说明刚才判断成立所依赖的关键条件。", why: "说明成立条件，才能避免把特定情境下的判断用于所有情境。" },
      EVIDENCE_PROBE: { question: "你刚才的判断可以用哪一条具体证据来支持？", focus: "为刚才的判断补充一条可核对的证据。", why: "把判断连到可观察的事实，才能区分有依据的解释与猜测。" },
      TRANSFER: { question: `换到一个新的具体场景，你会如何用“${topic}”解释其中的现象？`, focus: `检验“${topic}”在一个新场景中的应用。`, why: "换一个情境进行解释，可以检查原来的说法是否只适用于熟悉的例子。" },
      COUNTEREXAMPLE: { question: "你能给出一个会使刚才判断失效的情境吗？", focus: "检验你刚才判断的适用边界。", why: "找到可能失效的条件，可以帮助区分一般规律与过度概括。" },
      SCAFFOLDED_HINT: { question: supportQuestion({ ...input, unknownStreak: Math.max(1, input.unknownStreak) }).assistantMessage, focus: "先找到一个能用自己的话说明的概念或现象。", why: "先说清一个具体的起点，后续才能据此追问，而不需要猜一个完整答案。" },
    };
    const move = moves[questionType];
    const learningFeedback: LearningFeedback = {
      answerQuote: latestAnswer.trim().slice(0, 240),
      observation: lowInformation ? "模拟反馈：这次还没有足够的解释可供核验，我们先把问题缩小。" : "模拟反馈：已记录你的这段解释；以下练习根据表达线索安排，尚不能确认观点是否正确。",
      focus: input.selectedAction ? `围绕课程问题继续核验：${input.selectedAction.assistantMessage.slice(-150)}` : move.focus,
      whyItMatters: input.selectedAction ? "补充课程问题要求的关系或条件，才能核验刚才的解释是否足以用于这个情境。" : move.why,
      progress: null,
    };
    return coachTurnSchema.parse({
      assistantMessage: input.selectedAction?.assistantMessage ?? move.question,
      questionType: input.selectedAction?.questionType ?? questionType,
      learningFeedback: requireAnswerFeedback(learningFeedback, latestAnswer),
      learnerState: {
        masteryEstimate: 0,
        confirmedPoints: [],
        gaps: [learningFeedback.focus],
        misconceptions: [],
      },
      nextAction: "ASK_QUESTION",
      transitionReason: "模拟模式仅安排练习，学科理解仍待独立检验。",
    });
  }

  async createLearningReport(input: ReportInput): Promise<LearningReportDraft> {
    const topic = topicLabel(input.task.topic);
    const allUserText = [
      ...input.messages
        .filter((message) => message.role === "USER")
        .map((message) => message.content),
      input.feynmanExplanation,
    ].join("\n");

    const hasExample = /例如|比如|案例|例子|for example/i.test(allUserText);
    const hasTransfer = /迁移|应用|场景|如果|换到|推广/.test(allUserText);
    const lowInfo = isLowInformationAnswer(input.feynmanExplanation);
    const length = input.feynmanExplanation.trim().length;
    const meaningfulUserTurns = input.messages.filter(
      (message) =>
        message.role === "USER" && !isLowInformationAnswer(message.content),
    ).length;

    const base = lowInfo ? 45 : length > 120 ? 76 : 64;
    const conceptScore = Math.min(92, base + (allUserText.includes(topic) ? 8 : 0));
    const logicScore = Math.min(90, base + (/因为|所以|导致|因此/.test(allUserText) ? 8 : 0));
    const clarityScore = Math.min(88, base + (length > 80 ? 6 : 0));
    const exampleScore = hasExample ? 82 : 48;
    const transferScore = hasTransfer ? 80 : 46;

    const strengths: LearningReportDraft["strengths"] = [];
    if (!lowInfo && allUserText.includes(topic)) {
      strengths.push({
        title: `能围绕“${topic}”进行初步解释`,
        evidence: quoteEvidence(allUserText, (segment) => segment.includes(topic)),
      });
    }
    if (meaningfulUserTurns >= 2) {
      strengths.push({
        title: "能持续回应追问并补充自己的理解",
        evidence: quoteEvidence(allUserText, (segment) => !isLowInformationAnswer(segment)),
      });
    }
    if (hasExample) {
      strengths.push({
        title: "能使用例子辅助说明",
        evidence: quoteEvidence(allUserText, (segment) => /例如|比如|案例|例子|for example/i.test(segment)),
      });
    }
    if (hasTransfer) {
      strengths.push({
        title: "能尝试把知识迁移到新场景",
        evidence: quoteEvidence(allUserText, (segment) => /迁移|应用|场景|如果|换到|推广/.test(segment)),
      });
    }

    return learningReportDraftSchema.parse({
      summary: lowInfo
        ? `本次学习围绕“${topic}”进行了诊断和追问，但费曼讲解尚未展示足够信息，暂不能确认掌握情况。`
        : `本次学习围绕“${topic}”完成了诊断、追问和费曼讲解。已展示的理解仍需要进一步明确概念边界、原因链条和迁移条件。`,
      overallLevel: lowInfo ? "需要巩固" : "发展中",
      dimensions: {
        conceptCompleteness: {
          score: conceptScore,
          evidence: `学生在讲解中提到：“${input.feynmanExplanation.slice(0, 80)}”。`,
          feedback: "继续补充核心概念之间的边界和相互关系。",
        },
        logicCompleteness: {
          score: logicScore,
          evidence: /因为|所以|导致|因此/.test(allUserText)
            ? "学生尝试使用因果连接词组织解释。"
            : "本次对话未充分展示完整因果链条。",
          feedback: "用“条件-机制-结果”的顺序重写一次解释。",
        },
        expressionClarity: {
          score: clarityScore,
          evidence:
            length > 80
              ? "学生给出了连续成段的费曼讲解。"
              : "本次对话未充分展示稳定、清晰的完整表达。",
          feedback: "减少泛泛表述，把每句话指向一个明确概念。",
        },
        exampleAbility: {
          score: exampleScore,
          evidence: hasExample
            ? "学生主动使用了例子或案例来辅助说明。"
            : "本次对话未充分展示举例能力。",
          feedback: "下一轮至少加入一个贴近现实的例子。",
        },
        transferAbility: {
          score: transferScore,
          evidence: hasTransfer
            ? "学生尝试把知识放入新的场景或条件中讨论。"
            : "本次对话未充分展示迁移能力。",
          feedback: "尝试说明这个知识点在另一个情境中是否仍然成立。",
        },
      },
      strengths,
      gaps: [
        {
          title: "迁移条件还不够明确",
          evidence: hasTransfer
            ? "学生尝试了迁移，但没有完整说明新场景中的成立边界。"
            : "本次对话未充分展示对新情境成立条件的判断。",
          repairTask: "选择一个新场景，分别写出知识成立和不成立的条件。",
          priority: hasTransfer ? 3 : 5,
        },
        {
          title: "因果链条仍需要更完整",
          evidence: /因为|所以|导致|因此/.test(allUserText)
            ? "学生使用了因果连接词，但条件、机制和结果仍未完整对应。"
            : "本次对话未充分展示从条件到结果的完整因果链。",
          repairTask: "按照条件、机制、结果三个步骤重新解释一次。",
          priority: /因为|所以|导致|因此/.test(allUserText) ? 3 : 4,
        },
      ],
      nextSteps: [
        "用一个新例子重新解释核心概念。",
        "写出条件、机制、结果三句话。",
        "比较一个成立场景和一个不成立场景。",
      ],
      disclaimer: reportDisclaimer,
    });
  }

  async createFeynmanInstruction(input: FeynmanInstructionInput) {
    const topic = topicLabel(input.task.topic);
    return feynmanInstructionSchema.parse({
      assistantMessage: `请把“${topic}”讲给一位第一次接触它的同学听。`,
      requirements: ["用自己的话说明核心概念", "解释条件、机制与结果", "给出一个例子", "说明在新场景中的适用条件"],
    });
  }

  async createRetryTask(input: RetryTaskInput) {
    return retryTaskSchema.parse({
      topic: input.task.topic,
      objective: `针对“${input.gap.title}”完成再练：${input.gap.repairTask}`,
      rationale: `最高优先级漏洞：${input.gap.evidence}`,
    });
  }

  async summarizeLearningContext(input: ContextSummaryInput) {
    const userMessages = input.messages.filter((message) => message.role === "USER");
    return learningContextSummarySchema.parse({
      summary: `围绕“${topicLabel(input.task.topic)}”已记录 ${userMessages.length} 次学生表达。`,
      confirmedPoints: [],
      gaps: userMessages.length ? [] : ["尚无学生表达"],
      misconceptions: [],
    });
  }

  async createMaterialKeywords(input: MaterialKeywordsInput) {
    const candidates = `${input.title} ${input.content}`
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((value) => value.length >= 2);
    return materialKeywordsSchema.parse({ keywords: [...new Set(candidates)].slice(0, 6).concat(["课程材料", "学习目标", "知识点"]).slice(0, 6) });
  }
}
