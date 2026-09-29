import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import type { CoachTurnInput } from "@/lib/ai/types";
import type { CoachTurn } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";

const completion = (value: unknown) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(value) } }],
}), { status: 200 });

const contentPass = {
  minimumAnswer: "待核对的具体答案",
  verdict: "PASS",
  prerequisiteEvidence: [],
  conditionalCheck: null,
  answerDisclosure: null,
  inconsistentGivens: null,
  missingInformationQuote: null,
};
const teachingPass = {
  minimumAnswer: "待核对的具体答案",
  studentRuleAnswer: null,
  distinguishingEvidence: null,
  answerLeakQuote: null,
  missingInformationQuote: null,
  diagnosticRationale: "题目使用明确给定的整体范围，要求学生完成一个尚未展示的计算。",
  latestAnswerGrounded: true,
  feedbackQuestionAligned: true,
  meaningfulExplanation: true,
  progressGrounded: true,
  noAnswerLeak: true,
  questionAnswerable: true,
  scaffoldAppropriate: true,
  changeRecognized: true,
  diagnosticValue: true,
  respectfulFeedback: true,
};
const referenceText = "自有资本等于全部资产总额减去全部负债总额。";
const input: CoachTurnInput = {
  task: { course: undefined, chapter: undefined, topic: "资产与自有资本", objective: "确认统计范围并计算自有资本", learnerLevel: "入门", referenceText },
  phase: "SOCRATIC",
  socraticTurns: 1,
  maxTurns: 5,
  unknownStreak: 0,
  learnerState: null,
  messages: [],
  latestAnswer: "我只列出一项资产的金额，还没有说明全部资产和负债。",
};
function candidate(question: string): CoachTurn {
  return {
    assistantMessage: question,
    questionType: "TRANSFER",
    learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] },
    nextAction: "ASK_QUESTION",
    transitionReason: "确认范围后检验计算",
    learningFeedback: {
      answerQuote: input.latestAnswer!,
      observation: "你列出了一项资产，也说明还没有覆盖全部资产和负债。",
      focus: "核对给定金额的统计范围，再计算这个企业的自有资本。",
      whyItMatters: "确认是否覆盖全部项目，才能判断这些金额能否用于整体计算。",
      progress: null,
    },
  };
}
const wholeRuleEvidence = {
  fact: referenceText,
  kind: "DOMAIN_RULE",
  source: "REFERENCE",
  quote: referenceText,
};

// These responses are deliberately supplied by the test. They prove runtime
// rejection/acceptance boundaries, not a real model's semantic detection rate.
describe("mocked coaching scope-review gates", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPSEEK_API_KEY", "scope-boundary-test-key");
    vi.stubEnv("AI_MAX_RETRIES", "0");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false");
    resetServerEnvForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetServerEnvForTests();
  });

  it("rejects a condition-identification question whose defining term discloses the condition, despite PASS", async () => {
    const latestAnswer = "我认为所有三角形都可以直接套用这个平方关系。";
    const question = "已知两直角边的长度，在使用勾股定理前，需要确认三角形具有什么角？";
    const output = {
      ...candidate(question),
      questionType: "CONCEPT_CLARIFICATION",
      learningFeedback: {
        answerQuote: latestAnswer,
        observation: "你认为这个平方关系可以用于所有三角形。",
        focus: "核对使用这个关系需要满足的角条件。",
        whyItMatters: "先核对条件，可以明确这条关系是否适用于当前对象。",
        progress: null,
      },
    };
    const audit = {
      ...contentPass,
      minimumAnswer: "直角。",
      answerDisclosure: { field: "question", quote: "两直角边", disclosedAnswer: "直角。" },
    };
    expect(question).toContain(audit.answerDisclosure.quote);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(output))
      .mockResolvedValueOnce(completion(audit));

    await expect(new DeepSeekProvider({ fetcher }).createCoachTurn({
      ...input,
      latestAnswer,
      task: { course: undefined, chapter: undefined, topic: "勾股定理", objective: "识别适用条件", learnerLevel: "入门", referenceText: "在直角三角形中，两条直角边的平方和等于斜边的平方。" },
    })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsupported whole-object premise even when a local-property quotation exists and verdict is PASS", async () => {
    const question = "某企业有一项资产80万元、一笔负债30万元，这家企业的自有资本是多少？";
    const localQuote = "一项资产80万元、一笔负债30万元";
    const audit = {
      ...contentPass,
      minimumAnswer: "仅给出部分项目，无法确定企业全部资产与负债总额。",
      prerequisiteEvidence: [
        wholeRuleEvidence,
        { fact: "题目仅给出一项资产和一笔负债。", kind: "READING_ARITHMETIC", source: "QUESTION", quote: localQuote },
        { fact: "这两个项目分别覆盖企业全部资产与全部负债。", kind: "DOMAIN_RULE", source: "UNSUPPORTED", quote: null },
      ],
    };
    expect(question).toContain(localQuote);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(candidate(question)))
      .mockResolvedValueOnce(completion(audit));

    await expect(new DeepSeekProvider({ fetcher }).createCoachTurn(input))
      .rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("accepts a calculation with explicit total scope and grounded premises after all three calls", async () => {
    const question = "某企业全部资产合计80万元，全部负债合计30万元，这家企业的自有资本是多少？";
    const output = candidate(question);
    const minimumAnswer = "50万元。";
    const audit = {
      ...contentPass,
      minimumAnswer,
      prerequisiteEvidence: [
        wholeRuleEvidence,
        { fact: "给定的是全部资产及全部负债的合计金额。", kind: "READING_ARITHMETIC", source: "QUESTION", quote: "全部资产合计80万元，全部负债合计30万元" },
        { fact: "80减30等于50。", kind: "READING_ARITHMETIC", source: "BASIC_OPERATION", quote: null },
      ],
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(output))
      .mockResolvedValueOnce(completion(audit))
      .mockResolvedValueOnce(completion({ ...teachingPass, minimumAnswer }));

    const result = await new DeepSeekProvider({ fetcher }).createCoachTurn(input);
    expect(result).toEqual(output);
    expect(result).not.toHaveProperty("minimumAnswer");
    expect(result).not.toHaveProperty("prerequisiteEvidence");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("honors a teaching-review rejection when content review misses the whole-object scope error", async () => {
    const question = "某企业有一项资产80万元、一笔负债30万元，这家企业的自有资本是多少？";
    const incorrectMinimumAnswer = "50万元。";
    // Simulate a missed scope error: a literal quote is real, but the purported
    // whole-object fact is not entailed by it. The later reviewer rejects it.
    const audit = {
      ...contentPass,
      minimumAnswer: incorrectMinimumAnswer,
      prerequisiteEvidence: [
        wholeRuleEvidence,
        { fact: "企业全部资产80万元、全部负债30万元。", kind: "READING_ARITHMETIC", source: "QUESTION", quote: "一项资产80万元、一笔负债30万元" },
      ],
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(completion(candidate(question)))
      .mockResolvedValueOnce(completion(audit))
      .mockResolvedValueOnce(completion({
        ...teachingPass,
        minimumAnswer: incorrectMinimumAnswer,
        questionAnswerable: false,
        diagnosticRationale: "只给出局部项目金额，不能确定企业整体自有资本。",
      }));

    await expect(new DeepSeekProvider({ fetcher }).createCoachTurn(input))
      .rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
