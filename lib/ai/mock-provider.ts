import {
  CoachTurn,
  DiagnosticQuestion,
  LearningReportDraft,
  QuestionType,
} from "../contracts";
import { isLowInformationAnswer } from "../state-machine";
import type {
  AIProvider,
  CoachTurnInput,
  DiagnosticInput,
  ReportInput,
} from "./types";

const questionCycle: QuestionType[] = [
  "CONCEPT_CLARIFICATION",
  "CAUSE_PROBE",
  "ASSUMPTION_TEST",
  "COUNTEREXAMPLE",
  "TRANSFER",
];

function topicLabel(topic: string) {
  return topic.trim() || "这个知识点";
}

function supportQuestion(input: CoachTurnInput): CoachTurn {
  const topic = topicLabel(input.task.topic);
  const level = Math.min(input.unknownStreak, 3);

  if (level <= 1) {
    return {
      question: `先把范围缩小：在“${topic}”里，你最能确定的一个关键词或现象是什么？`,
      questionType: "SCAFFOLDED_HINT",
      suggestion: "CONTINUE",
    };
  }

  if (level === 2) {
    return {
      question: `给你一个二选一框架：你认为“${topic}”更像是概念之间的关系问题，还是条件变化导致的结果问题？`,
      questionType: "SCAFFOLDED_HINT",
      suggestion: "CONTINUE",
    };
  }

  return {
    question: `最小必要原理是先找核心概念、再说明条件和结果；你能用这三步解释“${topic}”吗？`,
    questionType: "SCAFFOLDED_HINT",
    suggestion: "CONTINUE",
  };
}

export class MockAIProvider implements AIProvider {
  async createDiagnosticQuestion(
    input: DiagnosticInput,
  ): Promise<DiagnosticQuestion> {
    const topic = topicLabel(input.task.topic);
    return {
      question: `在开始前，请用自己的话说明你现在如何理解“${topic}”，并说出一个你不确定的地方。`,
      questionType: "CONCEPT_CLARIFICATION",
    };
  }

  async createCoachTurn(input: CoachTurnInput): Promise<CoachTurn> {
    if (input.isHintRequest || input.unknownStreak > 0) {
      return supportQuestion(input);
    }

    const topic = topicLabel(input.task.topic);
    const questionType = questionCycle[input.socraticRound % questionCycle.length];
    const suggestion = input.socraticRound >= 3 ? "REQUEST_FEYNMAN" : "CONTINUE";

    const questions: Record<QuestionType, string> = {
      CONCEPT_CLARIFICATION: `你刚才的解释里，哪个概念是理解“${topic}”最关键的，为什么？`,
      CAUSE_PROBE: `如果“${topic}”发生变化，最先被影响的原因链条是哪一段？`,
      ASSUMPTION_TEST: `你的判断依赖了什么前提；如果这个前提不成立，结论会怎样变化？`,
      COUNTEREXAMPLE: `能不能构造一个看似符合“${topic}”但会推翻你说法的反例？`,
      TRANSFER: `如果把“${topic}”迁移到一个新场景，你会先检查哪个条件？`,
      SCAFFOLDED_HINT: `请把“${topic}”拆成一个概念、一个条件和一个结果来说明。`,
    };

    return {
      question: questions[questionType],
      questionType,
      suggestion,
    };
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

    const base = lowInfo ? 45 : length > 120 ? 76 : 64;
    const conceptScore = Math.min(92, base + (allUserText.includes(topic) ? 8 : 0));
    const logicScore = Math.min(90, base + (/因为|所以|导致|因此/.test(allUserText) ? 8 : 0));
    const clarityScore = Math.min(88, base + (length > 80 ? 6 : 0));
    const exampleScore = hasExample ? 82 : 48;
    const transferScore = hasTransfer ? 80 : 46;

    return {
      summary: `本次学习围绕“${topic}”完成了诊断、追问和费曼讲解。你已经能表达部分核心认识，但仍需要把概念边界、原因链条和迁移条件说得更明确。`,
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
      mastered: [`能围绕“${topic}”进行初步解释`, "能回应追问并修正部分表述"],
      gaps: ["迁移条件还不够明确", "因果链条仍需要更完整"],
      nextSteps: [
        "用一个新例子重新解释核心概念。",
        "写出条件、机制、结果三句话。",
        "比较一个成立场景和一个不成立场景。",
      ],
    };
  }
}
