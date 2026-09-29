import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import type { CoachTurnInput, SourcedCoachTurn } from "@/lib/ai/types";
import { learningFeedbackSchema } from "@/lib/learning-feedback";
import { resetServerEnvForTests } from "@/lib/env";

config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const records: Array<{ origin: "real_generation"; scenario: string; answer: string; output: SourcedCoachTurn }> = [];
type EvidenceOrigin = "real_generation" | "fixed_candidate_real_review" | "fixed_first_draft_real_repair";
const repairs: Array<{ scenario: string; injectedGenerationCalls: number; realGenerationCalls: number; realReviewCalls: number; output: SourcedCoachTurn | null }> = [];
const responseMetadata: Array<{
  origin: EvidenceOrigin; scenario: string; operation: "coach" | "coach_review" | "coach_content_review";
  httpStatus: number | null; finishReason: string | null;
  promptTokens: number | null; completionTokens: number | null; totalTokens: number | null;
  jsonParseable: boolean;
}> = [];
const requestEnvelopeSchema = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) });
const responseEnvelopeSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional() }),
  })).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
});
const coachDraftSchema = z.object({ assistantMessage: z.string(), learningFeedback: learningFeedbackSchema.optional() });

function requestOperation(init?: RequestInit): (typeof responseMetadata)[number]["operation"] {
  const request = requestEnvelopeSchema.parse(JSON.parse(String(init?.body)));
  if (request.messages.some((message) => message.role === "system" && message.content.includes("你是学习内容可用性复核模块"))) return "coach_content_review";
  return request.messages.some((message) => message.role === "system" && message.content.includes("你是学习反馈质量复核模块")) ? "coach_review" : "coach";
}

async function observedFetch(origin: EvidenceOrigin, scenario: string, url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const metadata: (typeof responseMetadata)[number] = {
    origin, scenario, operation: requestOperation(init),
    httpStatus: null, finishReason: null, promptTokens: null, completionTokens: null, totalTokens: null, jsonParseable: false,
  };
  const requestIndex = responseMetadata.push(metadata) - 1;
  const response = await fetch(url, init);
  metadata.httpStatus = response.status;
  try {
    const envelope = responseEnvelopeSchema.safeParse(await response.clone().json());
    if (envelope.success) {
      metadata.finishReason = envelope.data.choices?.[0]?.finish_reason ?? null;
      metadata.promptTokens = envelope.data.usage?.prompt_tokens ?? null;
      metadata.completionTokens = envelope.data.usage?.completion_tokens ?? null;
      metadata.totalTokens = envelope.data.usage?.total_tokens ?? null;
      const content = envelope.data.choices?.[0]?.message.content;
      if (content) {
        const parsedContent: unknown = JSON.parse(content);
        metadata.jsonParseable = true;
        if (metadata.operation === "coach" && origin !== "fixed_candidate_real_review") {
          const candidate = coachDraftSchema.safeParse(parsedContent);
          if (candidate.success) drafts.push({ origin, scenario, requestIndex, operation: "coach", content: candidate.data });
        } else if (metadata.operation === "coach_review") {
          const audit = fixtureReviewSchema.safeParse(parsedContent);
          if (audit.success) drafts.push({ origin, scenario, requestIndex, operation: "coach_review", content: audit.data });
        } else if (metadata.operation === "coach_content_review") {
          const audit = contentReviewSchema.safeParse(parsedContent);
          if (audit.success) drafts.push({ origin, scenario, requestIndex, operation: "coach_content_review", content: audit.data });
        }
      }
    }
  } catch {
    // Observe transport/JSON failures without changing the provider's behavior.
    // Only schema-selected content from these synthetic cases is retained.
    // Raw responses, reasoning, headers and credentials are never retained.
  }
  return response;
}
const fixtureReviewSchema = z.object({
  minimumAnswer: z.string(), studentRuleAnswer: z.string().nullable(), distinguishingEvidence: z.string().nullable(),
  answerLeakQuote: z.string().nullable(), diagnosticRationale: z.string(),
  latestAnswerGrounded: z.boolean(), feedbackQuestionAligned: z.boolean(), meaningfulExplanation: z.boolean(),
  progressGrounded: z.boolean(), noAnswerLeak: z.boolean(), questionAnswerable: z.boolean(),
  scaffoldAppropriate: z.boolean(), changeRecognized: z.boolean(),
  diagnosticValue: z.boolean(), respectfulFeedback: z.boolean(),
  missingInformationQuote: z.string().nullable(),
});
const contentReviewSchema = z.object({
  minimumAnswer: z.string(),
  verdict: z.enum(["PASS", "ANSWER_DISCLOSED", "INCONSISTENT_GIVENS", "MISSING_INFORMATION", "UNSUPPORTED_PREREQUISITE", "UNCERTAIN"]),
  answerDisclosure: z.object({ field: z.enum(["question", "observation", "focus", "whyItMatters", "progress"]), quote: z.string(), disclosedAnswer: z.string() }).nullable(),
  inconsistentGivens: z.object({ quotes: z.array(z.string()), conflict: z.string() }).nullable(),
  missingInformationQuote: z.string().nullable(),
  prerequisiteEvidence: z.array(z.object({
    fact: z.string(), kind: z.enum(["READING_ARITHMETIC", "DOMAIN_RULE"]),
    source: z.enum(["STUDENT", "REFERENCE", "QUESTION", "BASIC_OPERATION", "UNSUPPORTED"]), quote: z.string().nullable(),
  })),
});
const drafts: Array<{
  origin: EvidenceOrigin; scenario: string; requestIndex: number;
} & (
  | { operation: "coach"; content: z.infer<typeof coachDraftSchema> }
  | { operation: "coach_review"; content: z.infer<typeof fixtureReviewSchema> }
  | { operation: "coach_content_review"; content: z.infer<typeof contentReviewSchema> }
)> = [];
const fixtureReviews: Array<{
  origin: "fixed_candidate_real_review"; scenario: string; expected: "reject" | "accept";
  candidate: SourcedCoachTurn; review: z.infer<typeof fixtureReviewSchema> | null;
  contentReview: z.infer<typeof contentReviewSchema> | null;
  injectedGenerationCalls: number; realReviewCalls: number;
}> = [];
const task = {
  course: undefined,
  chapter: undefined,
  topic: "勾股定理的适用条件",
  objective: "区分直角三角形条件与一般三角形，并用自己的话解释边长关系的适用范围。",
  learnerLevel: "入门",
  referenceText: "勾股定理适用于直角三角形，两条直角边的平方和等于斜边的平方；斜边是直角所对的边。",
};

async function ask(scenario: string, answer: string, history: CoachTurnInput["messages"] = []): Promise<SourcedCoachTurn> {
  const output = await new DeepSeekProvider({ fetcher: (url, init) => observedFetch("real_generation", scenario, url, init) }).createCoachTurn({
    task, phase: "SOCRATIC", socraticTurns: history.length > 0 ? 1 : 0, maxTurns: 5,
    unknownStreak: answer === "不知道" ? 1 : 0, learnerState: null,
    latestAnswer: answer,
    messages: [...history, { role: "USER", phase: "SOCRATIC", content: answer, questionType: null }],
    knowledgePolicy: "MODEL_FALLBACK",
  });
  records.push({ origin: "real_generation", scenario, answer, output });
  const feedback = learningFeedbackSchema.parse(output.learningFeedback);
  expect(answer).toContain(feedback.answerQuote);
  expect(output.assistantMessage.match(/[?？]/g)).toHaveLength(1);
  expect(`${feedback.observation} ${feedback.progress ?? ""}`).not.toMatch(/你已经完全掌握|你的理解完全正确|完全没有问题/);
  expect(`${feedback.observation} ${feedback.whyItMatters}`).not.toMatch(/如果连.{0,40}都|这么简单.*还不会/u);
  expect(feedback.observation).not.toMatch(/^学生|^该学生/u);
  expect(feedback.focus).not.toMatch(/取得学生|获取学生|取得.{0,30}证据/u);
  if (!history.some((message) => message.role === "USER" && message.content !== answer)) expect(feedback.progress).toBeNull();
  if (output.questionType === "COUNTEREXAMPLE" && /(?:举|构造|找出|给出).*(?:反例|例子|情境|案例|三角形)/u.test(output.assistantMessage)) {
    expect(output.assistantMessage).toMatch(/是否存在|是否可能|能否存在|不存在|不可能|若没有|如果没有/u);
  }
  return output;
}

async function reviewFixedCandidate(
  scenario: string,
  expected: "reject" | "accept",
  candidate: SourcedCoachTurn,
  answer: string,
  history: CoachTurnInput["messages"] = [],
  contextTask: CoachTurnInput["task"] = task,
): Promise<(typeof fixtureReviews)[number]> {
  const record: (typeof fixtureReviews)[number] = { origin: "fixed_candidate_real_review", scenario, expected, candidate, review: null, contentReview: null, injectedGenerationCalls: 0, realReviewCalls: 0 };
  fixtureReviews.push(record);
  vi.stubEnv("AI_MAX_RETRIES", "0");
  resetServerEnvForTests();
  try {
    const provider = new DeepSeekProvider({ fetcher: async (url, init) => {
      const operation = requestOperation(init);
      if (operation === "coach") {
        record.injectedGenerationCalls += 1;
        if (record.injectedGenerationCalls !== 1) throw new Error("The fixed candidate must not regenerate.");
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200 });
      }
      record.realReviewCalls += 1;
      const response = await observedFetch("fixed_candidate_real_review", scenario, url, init);
      if (response.ok) {
        try {
          const envelope = responseEnvelopeSchema.parse(await response.clone().json());
          const content = envelope.choices?.[0]?.message.content;
          const parsed: unknown = content ? JSON.parse(content) : null;
          if (operation === "coach_review") {
            const reviewed = fixtureReviewSchema.safeParse(parsed);
            if (reviewed.success) record.review = reviewed.data;
          } else {
            const reviewed = contentReviewSchema.safeParse(parsed);
            if (reviewed.success) record.contentReview = reviewed.data;
          }
        } catch {
          // The provider, not this observer, determines malformed-output errors.
        }
      }
      return response;
    } });
    const operation = provider.createCoachTurn({
      task: contextTask, phase: "SOCRATIC", socraticTurns: history.length > 0 ? 1 : 0, maxTurns: 5,
      unknownStreak: answer === "不知道" ? 1 : 0, learnerState: null, latestAnswer: answer,
      messages: [...history, { role: "USER", phase: "SOCRATIC", content: answer, questionType: null }],
      knowledgePolicy: "MODEL_FALLBACK",
    });
    if (expected === "reject") await expect(operation).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    else expect((await operation).assistantMessage).toBe(candidate.assistantMessage);
    expect(record.injectedGenerationCalls).toBe(1);
    expect(record.realReviewCalls).toBeGreaterThanOrEqual(1);
    expect(record.realReviewCalls).toBeLessThanOrEqual(2);
    expect(record.contentReview).not.toBeNull();
    if (expected === "accept") {
      expect(record.realReviewCalls).toBe(2);
      expect(record.contentReview?.verdict).toBe("PASS");
      expect(record.review).not.toBeNull();
    }
    return record;
  } finally {
    vi.stubEnv("AI_MAX_RETRIES", "1");
    resetServerEnvForTests();
  }
}

describe.skipIf(!enabled)("DeepSeek live coaching feedback", () => {
  beforeAll(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false");
    vi.stubEnv("AI_MAX_RETRIES", "1");
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "60000");
    resetServerEnvForTests();
  });
  afterAll(async () => {
    await mkdir(".data/coaching-live", { recursive: true });
    const generatedAt = new Date().toISOString();
    await writeFile(`.data/coaching-live/recheck-${generatedAt.replace(/[:.]/g, "-")}.json`, JSON.stringify({ generatedAt, evidenceScope: "records为合成学生回答的真实生成；fixtureReviews为固定候选题注入后调用真实模型审核；repairs仅注入首份错误草稿，后续生成和审核为真实调用；drafts包含这些合成案例的未批准草稿及结构化审核结果，不代表已返回学生。均不代表真实教学成效或生产验收。", model: process.env.DEEPSEEK_MODEL, records, fixtureReviews, repairs, responseMetadata, drafts }, null, 2), "utf8");
    vi.unstubAllEnvs();
    resetServerEnvForTests();
  });

  it("generation flow clarifies an incorrect condition before moving to application", async () => {
    const output = await ask("incorrect-condition", "我认为任何三角形都能用勾股定理，只要知道两条边就能求第三边。");
    expect(`${output.learningFeedback?.focus} ${output.assistantMessage}`).toMatch(/条件|角|三角形|适用/);
    expect(output.learningFeedback?.progress).toBeNull();
  }, 180_000);

  it("generation flow explains why an unknown answer needs a smaller starting point", async () => {
    const output = await ask("unknown-answer", "不知道");
    expect(output.questionType).toBe("SCAFFOLDED_HINT");
    expect(output.learningFeedback?.observation).toMatch(/还|尚|不确定|不足|没有|暂|未/);
    expect(output.learningFeedback?.progress).toBeNull();
    if (/哪.{0,3}类三角形|三角形类型/u.test(output.learningFeedback?.focus ?? "")) {
      expect(output.assistantMessage).not.toMatch(/(?:满足|有什么|是什么).{0,8}(?:关系|公式)|边之间/u);
    }
  }, 180_000);

  it("generation flow connects a revision to the earlier expressed misunderstanding", async () => {
    const initial = "我原来以为所有三角形都适用这个等式，没有关注角的条件。";
    const first = await ask("revision-before", initial);
    expect(first.learningFeedback?.progress).toBeNull();
    const revised = "我修正了原来的看法：只有直角三角形才适用，斜边是直角对面的边；不能只看到三条边就直接套用。";
    const second = await ask("revision-after", revised, [
      { role: "USER", phase: "SOCRATIC", content: initial, questionType: null },
      { role: "ASSISTANT", phase: "SOCRATIC", content: first.assistantMessage, questionType: first.questionType },
    ]);
    expect(second.learningFeedback?.observation).toMatch(/直角|条件|适用|斜边/);
    // A visible comparison may be in observation or progress. It must name both
    // the previous belief and the actual revision, not just mention this topic.
    const comparison = `${second.learningFeedback?.observation} ${second.learningFeedback?.progress ?? ""}`;
    expect(comparison).toMatch(/原来|原先|之前|此前|上次|前一轮|相比/);
    expect(comparison).toMatch(/现在|这次|明确|修正|补充|转为/);
    expect(comparison).toMatch(/直角|条件|所有|任意|适用|斜边/);
  }, 300_000);

  it.each(["reject", "accept"] as const)("real reviewer should %s the fixed diagnostic candidate", async (expected) => {
    const answer = "我认为任何三角形都能用勾股定理，只要知道两条边就能求第三边。";
    // The negative question is replayed from the saved 2026-09-28T16:21:38 live
    // output. The positive control tests the same claim with a useful case.
    const candidate: SourcedCoachTurn = {
      assistantMessage: expected === "reject"
        ? "在你刚才说的“任何三角形”里，如果取一个三条边分别是3、4、5的三角形，它是否一定能用勾股定理来求第三边，为什么？"
        : "在边长为2、3、4的三角形中，两条较短边的平方和是否等于最长边的平方？",
      questionType: "ASSUMPTION_TEST",
      learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: ["适用范围待核验"], misconceptions: ["认为任何三角形都满足该平方关系"] },
      nextAction: "ASK_QUESTION", transitionReason: "核验适用范围",
      learningFeedback: {
        answerQuote: answer,
        observation: "你把适用范围表达成了任何三角形，还需要检查这个范围。",
        focus: "检验任意三角形是否都满足这个平方关系。",
        whyItMatters: "核对具体情形可以帮助判断原来的适用范围是否过大。",
        progress: null,
      },
    };
    const record = await reviewFixedCandidate(expected === "reject" ? "observed-nondiscriminating-positive-case" : "valid-discriminating-computation", expected, candidate, answer);
      if (expected === "accept") {
        expect(record.review?.diagnosticRationale).toBeTruthy();
        expect(record.review?.studentRuleAnswer).toBeTruthy();
        expect(record.review?.diagnosticValue).toBe(true);
        expect(record.review?.minimumAnswer).toMatch(/13|十三/u);
        expect(record.review?.minimumAnswer).toMatch(/16|十六/u);
        expect(record.review?.distinguishingEvidence).toBeTruthy();
        expect(record.contentReview?.prerequisiteEvidence.every((item) => item.source !== "UNSUPPORTED")).toBe(true);
        expect(record.review?.respectfulFeedback).toBe(true);
      } else {
        // This candidate also needs an unestablished converse. Either a real
        // discrimination failure or that specific unsupported prerequisite is
        // a valid reason to reject it; arbitrary errors are not sufficient.
        const unsupportedConverse = record.contentReview?.verdict === "UNSUPPORTED_PREREQUISITE"
          && record.contentReview.prerequisiteEvidence.some((item) => item.source === "UNSUPPORTED"
            && /逆定理|逆命题|逆向|若.*(?:等于|相等).*直角|(?:等于|相等).*则.*直角/u.test(item.fact));
        expect(record.review?.diagnosticValue === false || unsupportedConverse).toBe(true);
        // Lack of prerequisite teaching cannot change the mathematical fact:
        // a 3/4/5 triangle is right-angled and the theorem does apply to it.
        const actualAnswer = record.contentReview?.minimumAnswer ?? "";
        expect(actualAnswer).toMatch(/能|可以|直角三角形/u);
        expect(actualAnswer).not.toMatch(/不能|不一定|非直角/u);
        // Rejected audit prose is discarded; rejection and diagnosticValue=false
        // are the contract. Only an accepted misconception probe needs a contrast.
      }
  }, 90_000);

  it.each([
    { scenario: "observed-answer-in-observation", answer: "我认为任何三角形都能用勾股定理，只要知道两条边就能求第三边。", question: "三角形必须先满足什么样的角的条件，平方和等于斜边平方的关系才成立？", observation: "你把适用范围扩大到了直角三角形以外，目前还没有给出支持这一点的理由。", focus: "核验这一关系成立的角的条件。", why: "确认适用条件才能避免误用公式。", expectedCheck: "noAnswerLeak" },
    { scenario: "observed-answer-in-terminology", answer: "我原来以为所有三角形都适用这个等式，没有关注角的条件。", question: "判断一个三角形是否满足“两直角边平方和等于斜边平方”之前，你需要先确认它的哪个角是什么角？", observation: "你提到自己原先忽略了角的条件，但还没有说明具体条件。", focus: "指出关系成立时必须存在的是哪一种角。", why: "确认适用条件才能避免扩大适用范围。", expectedCheck: "noAnswerLeak" },
    { scenario: "observed-answer-in-counterexample-label", answer: "我认为任何三角形都能用勾股定理，只要知道两条边就能求第三边。", question: "边长为3、4、6的三角形是否满足3²+4²=6²，依据是什么？", observation: "你认为任何三角形都可以使用这个平方关系。", focus: "用这组边长检验平方关系是否成立。", why: "这能帮你判断原来的说法是否经得起这个具体反例的检验。", expectedCheck: "noAnswerLeak" },
    { scenario: "observed-unsupported-converse", answer: "只有直角三角形才适用，斜边是直角对面的边；不能只看到三条边就直接套用。", question: "如果只知道一个三角形三边的长度，你怎样判断它是不是直角三角形，从而决定能否使用这个等式？", observation: "你确认了适用范围和斜边的位置，但没有说明如何用三边判断直角。", focus: "由三边长度判断是否是直角三角形。", why: "确认条件才能判断是否可以使用等式。", expectedCheck: "prerequisitesSupported" },
    { scenario: "unavailable-labeled-figure", answer: "不知道", question: "请看图中的三角形ABC，哪一条边是直角所对的边？", observation: "目前还没有足够表达来判断你对角和边的理解。", focus: "根据直角确定它所对的边。", why: "确认角与边的对应有助于后续辨认边长关系。", expectedCheck: "questionAnswerable" },
    { scenario: "observed-inconsistent-triangle", answer: "只有直角三角形才适用，斜边是直角对面的边。", question: "假设有一个三角形，它的三边分别是3、4、5，但其中最大的角是80°。你能不能用勾股定理来判断它是不是直角三角形，为什么？", observation: "你明确了适用范围，但还没有说明如何用边长判断角的类型。", focus: "从给出的边角条件判断公式是否适用。", why: "判断前核对条件可以避免误用公式。", expectedCheck: "questionAnswerable" },
  ] as const)("real reviewer rejects $scenario", async ({ scenario, answer, question, observation, focus, why, expectedCheck }) => {
    // Replays the semantic defects found during manual review. Passing these
    // controls requires the relevant diagnosis, not a transport/JSON failure.
    const candidate: SourcedCoachTurn = {
      assistantMessage: question, questionType: answer === "不知道" ? "SCAFFOLDED_HINT" : "CONCEPT_CLARIFICATION",
      learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [focus], misconceptions: [] },
      nextAction: "ASK_QUESTION", transitionReason: "核验当前缺口",
      learningFeedback: { answerQuote: answer, observation, focus, whyItMatters: why, progress: null },
    };
    const record = await reviewFixedCandidate(scenario, "reject", candidate, answer);
    if (expectedCheck === "noAnswerLeak") {
      expect(record.contentReview?.verdict).toBe("ANSWER_DISCLOSED");
      expect(record.contentReview?.answerDisclosure?.quote).toBeTruthy();
    } else if (expectedCheck === "questionAnswerable") {
      expect(record.contentReview?.verdict).toBe(scenario === "observed-inconsistent-triangle" ? "INCONSISTENT_GIVENS" : "MISSING_INFORMATION");
    } else {
      expect(record.contentReview?.verdict).toBe("UNSUPPORTED_PREREQUISITE");
      expect(record.contentReview?.prerequisiteEvidence.some((item) => item.kind === "DOMAIN_RULE" && item.source === "UNSUPPORTED"
        && /逆定理|逆命题|逆向|若.*(?:等于|相等).*直角|(?:等于|相等).*则.*直角/u.test(item.fact))).toBe(true);
    }
  }, 90_000);

  it("real reviewer accepts a supported application after the student corrects the condition", async () => {
    // Replay the valid application rejected in the 17:22 live run. Naming an
    // already established theorem does not disclose the requested new length.
    const answer = "我修正了原来的看法：只有直角三角形才适用，斜边是直角对面的边；不能只看到三条边就直接套用。";
    const candidate: SourcedCoachTurn = {
      assistantMessage: "在三角形ABC中，∠B=90°，AB=3，BC=4，AC的长度是多少，依据是什么？",
      questionType: "TRANSFER",
      learnerState: { masteryEstimate: 35, confirmedPoints: ["适用条件和斜边位置"], gaps: ["尚未用具体边长展示应用"], misconceptions: [] },
      nextAction: "ASK_QUESTION", transitionReason: "由正确的条件说明进入一个条件完整的小应用",
      learningFeedback: {
        answerQuote: answer,
        observation: "你已经把适用范围修正为直角三角形，也说明了斜边的位置。",
        focus: "把已说明的角和边的关系用于具体计算。",
        whyItMatters: "在具体三角形里用上勾股定理，可以检查你是否能把刚才的条件说明转化为求边步骤。",
        progress: "相比原来认为所有三角形都适用，你现在已明确限定了适用条件。",
      },
    };
    const record = await reviewFixedCandidate("valid-application-after-revision", "accept", candidate, answer, [
      { role: "USER", phase: "SOCRATIC", content: "我原来以为所有三角形都适用这个等式，没有关注角的条件。", questionType: null },
      { role: "ASSISTANT", phase: "SOCRATIC", content: "这个关系成立时，三角形必须满足什么角的条件？", questionType: "CONCEPT_CLARIFICATION" },
    ]);
    expect(record.review?.minimumAnswer).toMatch(/5|五/u);
    expect(record.review?.studentRuleAnswer).toBeNull();
    expect(record.review?.diagnosticValue).toBe(true);
    expect(record.contentReview?.prerequisiteEvidence.every((item) => item.source !== "UNSUPPORTED")).toBe(true);
    expect(record.review?.noAnswerLeak).toBe(true);
  }, 90_000);

  it("real reviewer isolates discrimination with fully supported prerequisites", async () => {
    // Unlike the triangle control, all prerequisites are explicitly available.
    // Both the actual arithmetic and the wrong rule answer this yes/no item yes.
    const answer = "我认为所有偶数都是4的倍数。";
    const candidate: SourcedCoachTurn = {
      assistantMessage: "8是4的倍数吗？", questionType: "ASSUMPTION_TEST",
      learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: ["偶数与4的倍数的范围关系"], misconceptions: ["认为所有偶数都是4的倍数"] },
      nextAction: "ASK_QUESTION", transitionReason: "检验范围主张",
      learningFeedback: {
        answerQuote: answer, observation: "你认为所有偶数都属于4的倍数，还需要检验这个范围。",
        focus: "用一个具体整数检验你提出的范围关系。",
        whyItMatters: "核对具体数值能帮助判断原来的范围说明是否充分。", progress: null,
      },
    };
    const record = await reviewFixedCandidate("nondiscriminating-positive-with-supported-prerequisites", "reject", candidate, answer, [], {
      course: undefined, chapter: undefined,
      topic: "偶数与4的倍数", objective: "区分偶数和4的倍数的范围。", learnerLevel: "入门",
      referenceText: "能被2整除的整数是偶数；能被4整除的整数是4的倍数。可以用除法和余数检验。",
    });
    expect(record.review?.minimumAnswer).toMatch(/是|yes/ui);
    expect(record.review?.studentRuleAnswer).toBeTruthy();
    expect(record.contentReview?.prerequisiteEvidence.every((item) => item.source !== "UNSUPPORTED")).toBe(true);
    expect(record.review?.diagnosticValue).toBe(false);
    expect(record.review?.distinguishingEvidence).toBeNull();
  }, 90_000);

  it("generation flow repairs a rejected leaked-answer draft within the existing retry", async () => {
    const answer = "我认为任何三角形都能用勾股定理，只要知道两条边就能求第三边。";
    const candidate: SourcedCoachTurn = {
      assistantMessage: "勾股定理适用于哪一类三角形？", questionType: "CONCEPT_CLARIFICATION",
      learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: ["适用条件尚未澄清"], misconceptions: ["扩大适用范围"] },
      nextAction: "ASK_QUESTION", transitionReason: "澄清适用条件",
      learningFeedback: { answerQuote: answer, observation: "你还没有认识到这个定理只适用于直角三角形。", focus: "说出定理适用的三角形类型。", whyItMatters: "确认条件可以避免在不适用的情境中套公式。", progress: null },
    };
    const record: (typeof repairs)[number] = { scenario: "repair-leaked-condition", injectedGenerationCalls: 0, realGenerationCalls: 0, realReviewCalls: 0, output: null };
    repairs.push(record);
    const provider = new DeepSeekProvider({ fetcher: async (url, init) => {
      if (requestOperation(init) === "coach") {
        if (!record.injectedGenerationCalls) {
          record.injectedGenerationCalls += 1;
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200 });
        }
        record.realGenerationCalls += 1;
      } else record.realReviewCalls += 1;
      return observedFetch("fixed_first_draft_real_repair", record.scenario, url, init);
    } });
    record.output = await provider.createCoachTurn({ task, phase: "SOCRATIC", socraticTurns: 0, maxTurns: 5, unknownStreak: 0, learnerState: null, latestAnswer: answer, messages: [{ role: "USER", phase: "SOCRATIC", content: answer, questionType: null }], knowledgePolicy: "MODEL_FALLBACK" });
    expect(record.injectedGenerationCalls).toBe(1);
    expect(record.realGenerationCalls).toBe(1);
    expect(record.realReviewCalls).toBe(3);
    expect(record.output.learningFeedback).not.toEqual(candidate.learningFeedback);
    expect(answer).toContain(record.output.learningFeedback?.answerQuote);
    const reviews = drafts.filter((draft) => draft.scenario === record.scenario && draft.operation === "coach_content_review");
    expect(reviews).toHaveLength(2);
    if (reviews[0]?.operation === "coach_content_review" && reviews[1]?.operation === "coach_content_review") {
      expect(reviews[0].content.verdict).toBe("ANSWER_DISCLOSED");
      expect(reviews[0].content.answerDisclosure?.quote).toBeTruthy();
      expect(reviews[1].content.verdict).toBe("PASS");
      expect(reviews[1].content.answerDisclosure).toBeNull();
    }
  }, 180_000);
});
