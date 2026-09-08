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
import { mockAssessLearningTurn } from "./mock-assessment-v12";
import type { TurnAssessmentInput } from "./types";
import type {
  AIProvider,
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

const questionCycle: QuestionType[] = [
  "CONCEPT_CLARIFICATION",
  "CAUSE_PROBE",
  "EVIDENCE_PROBE",
  "ASSUMPTION_TEST",
  "COUNTEREXAMPLE",
  "TRANSFER",
];

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
      learnerState: input.learnerState ?? { masteryEstimate: 20, confirmedPoints: [], gaps: [topic], misconceptions: [] },
      nextAction: "ASK_QUESTION",
      transitionReason: "学生需要缩小问题范围。",
    });
  }

  if (level === 2) {
    return coachTurnSchema.parse({
      assistantMessage: `给你一个二选一框架：你认为“${topic}”更像是概念之间的关系问题，还是条件变化导致的结果问题？`,
      questionType: "SCAFFOLDED_HINT",
      learnerState: input.learnerState ?? { masteryEstimate: 20, confirmedPoints: [], gaps: [topic], misconceptions: [] },
      nextAction: "ASK_QUESTION",
      transitionReason: "学生需要二选一支架。",
    });
  }

  return coachTurnSchema.parse({
    assistantMessage: `最小必要原理是先找核心概念、再说明条件和结果；你能用这三步解释“${topic}”吗？`,
    questionType: "SCAFFOLDED_HINT",
    learnerState: input.learnerState ?? { masteryEstimate: 20, confirmedPoints: [], gaps: [topic], misconceptions: [] },
    nextAction: "ASK_QUESTION",
    transitionReason: "学生需要最小必要原理。",
  });
}

export class MockAIProvider implements AIProvider {
  async selectTeachingMove(input: import("./teaching-schema").TeachingSelection) {
    const studentAnchor = input.studentContent.match(/[^?？\r\n]{2,30}/u)?.[0].trim() ?? "";
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
    if (input.isHintRequest || input.unknownStreak > 0) {
      return supportQuestion(input);
    }

    const topic = topicLabel(input.task.topic);
    const questionType = questionCycle[input.socraticTurns % questionCycle.length];
    const nextAction = input.socraticTurns >= 3 ? "REQUEST_FEYNMAN" : "ASK_QUESTION";

    const questions: Record<QuestionType, string> = {
      CONCEPT_CLARIFICATION: `你刚才的解释里，哪个概念是理解“${topic}”最关键的，为什么？`,
      CAUSE_PROBE: `如果“${topic}”发生变化，最先被影响的原因链条是哪一段？`,
      ASSUMPTION_TEST: `你的判断依赖了什么前提；如果这个前提不成立，结论会怎样变化？`,
      COUNTEREXAMPLE: `能不能构造一个看似符合“${topic}”但会推翻你说法的反例？`,
      EVIDENCE_PROBE: `你刚才的判断可以用哪一条具体证据来支持？`,
      TRANSFER: `如果把“${topic}”迁移到一个新场景，你会先检查哪个条件？`,
      SCAFFOLDED_HINT: `请把“${topic}”拆成一个概念、一个条件和一个结果来说明。`,
    };

    return coachTurnSchema.parse({
      assistantMessage: questions[questionType],
      questionType,
      learnerState: {
        masteryEstimate: Math.min(90, 35 + input.socraticTurns * 15),
        confirmedPoints: [`能够继续解释“${topic}”`],
        gaps: input.socraticTurns >= 2 ? [] : [`“${topic}”的条件与机制仍需澄清`],
        misconceptions: [],
      },
      nextAction,
      transitionReason: nextAction === "REQUEST_FEYNMAN" ? "已完成至少三轮追问，可检验独立讲解。" : "仍需继续追问。",
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
