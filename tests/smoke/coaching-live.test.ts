import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import type { CoachTurnInput, SourcedCoachTurn } from "@/lib/ai/types";
import { learningFeedbackSchema } from "@/lib/learning-feedback";
import { resetServerEnvForTests } from "@/lib/env";
import { coachConditionalCheckSchema } from "@/lib/ai/coach-feedback";
import { coachTurnSchema } from "@/lib/contracts";
import boundaryReplays from "./coach-boundary-replays.json";

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
  verdict: z.enum(["PASS", "ANSWER_DISCLOSED", "INCONSISTENT_GIVENS", "MISSING_INFORMATION", "UNSUPPORTED_PREREQUISITE", "AMBIGUOUS_QUESTION", "UNCERTAIN"]),
  conditionalCheck: coachConditionalCheckSchema.nullable(),
  answerDisclosure: z.object({ field: z.enum(["question", "observation", "focus", "whyItMatters", "progress"]), quote: z.string(), disclosedAnswer: z.string() }).nullable(),
  inconsistentGivens: z.object({ quotes: z.array(z.string()), conflict: z.string() }).nullable(),
  missingInformationQuote: z.string().nullable(),
  prerequisiteEvidence: z.array(z.object({
    fact: z.string(), kind: z.enum(["READING_ARITHMETIC", "DOMAIN_RULE"]),
    source: z.enum(["STUDENT", "REFERENCE", "QUESTION", "BASIC_OPERATION", "UNSUPPORTED"]), quote: z.string().nullable(),
  })),
});

function assertPositiveTriangleRejection(
  audit: Pick<z.infer<typeof contentReviewSchema>, "minimumAnswer" | "verdict" | "prerequisiteEvidence">,
  review: Pick<z.infer<typeof fixtureReviewSchema>, "minimumAnswer" | "diagnosticValue"> | null,
) {
  const unsupportedConverse = audit.verdict === "UNSUPPORTED_PREREQUISITE"
    && audit.prerequisiteEvidence.some((item) => item.kind === "DOMAIN_RULE" && item.source === "UNSUPPORTED"
      && /逆定理|逆命题|逆向|若.*(?:等于|相等).*直角|(?:等于|相等).*则.*直角/u.test(item.fact));
  expect(review?.diagnosticValue === false || unsupportedConverse).toBe(true);
  const answers = [audit.minimumAnswer, ...(review ? [review.minimumAnswer] : [])];
  for (const claim of [...answers, ...audit.prerequisiteEvidence.map((item) => item.fact)]) {
    // Missing teaching support never changes the actual 3/4/5 triangle.
    expect(claim).not.toMatch(/非直角三角形|(?:不是|并非|不一定是|不必然是)直角三角形/u);
    expect(claim).not.toMatch(/不适用|不可用|(?:不能|不可|无法|不一定能|不一定可)(?:直接)?(?:用|使用|应用|套用)勾股定理/u);
  }
  for (const answer of answers) {
    const epistemicallyUnconfirmed = /(?:不能|无法|尚不能)(?:据此)?(?:确认|确定|判定|推出|证明)|未(?:能)?(?:确认|确定|判定)|(?:材料|依据|信息)不足/u.test(answer);
    const missingTaughtRule = /(?:材料|资料|给定|所给|本次|已有|参考)[^。；]{0,40}(?:未提供|未给出|未说明|没有|缺少|不足)|(?:未提供|未给出|缺少|未建立)[^。；]{0,25}(?:逆定理|逆命题|规则|依据)/u.test(answer);
    const correctMathematicalAnswer = !epistemicallyUnconfirmed
      && /(?:^|[。；])\s*(?:能|可以)|(?:是|为)直角三角形/u.test(answer);
    // Accept a true mathematical answer, or (only for the actual unsupported
    // converse rejection) an explicit lack-of-taught-basis explanation.
    expect(correctMathematicalAnswer || (unsupportedConverse && epistemicallyUnconfirmed && missingTaughtRule)).toBe(true);
  }
}

describe("positive-triangle rejection calibration", () => {
  const inverse = "若三角形三边满足a²+b²=c²，则它是直角三角形（勾股定理逆定理）。";
  const unconfirmed = "信息不足：需先有勾股定理逆定理判定3、4、5三角形是直角三角形；材料未提供该逆定理，故不能确认勾股定理适用。";
  const correct = "可以，3²+4²=5²，这个三角形是直角三角形。";
  it.each([
    { source: "07-49-56-127Z: missing taught converse, not false mathematics", answer: unconfirmed, unsupportedFact: inverse, diagnosticValue: null, accepted: true },
    { source: "synthetic: true mathematical answer with unsupported converse", answer: correct, unsupportedFact: inverse, diagnosticValue: null, accepted: true },
    { source: "synthetic: mathematically correct nondiscrimination rejection", answer: correct, unsupportedFact: null, diagnosticValue: false, accepted: true },
    { source: "synthetic: unsupported teaching cannot make the triangle non-right", answer: "3、4、5三角形不是直角三角形，因此不能使用勾股定理。", unsupportedFact: inverse, diagnosticValue: null, accepted: false },
    { source: "synthetic: unavailable converse cannot make the theorem inapplicable", answer: `${unconfirmed}所以勾股定理不适用于这个三角形。`, unsupportedFact: inverse, diagnosticValue: null, accepted: false },
    { source: "synthetic: a true fact cannot excuse a contradictory applicability claim", answer: `${correct}但不一定能用勾股定理。`, unsupportedFact: inverse, diagnosticValue: null, accepted: false },
    { source: "synthetic: unrelated unsupported knowledge is not a converse rejection", answer: unconfirmed, unsupportedFact: "还需要三角形面积公式。", diagnosticValue: null, accepted: false },
    { source: "synthetic: nondiscrimination alone still requires correct mathematics", answer: unconfirmed, unsupportedFact: null, diagnosticValue: false, accepted: false },
  ])("$source", ({ answer, unsupportedFact, diagnosticValue, accepted }) => {
    const check = () => assertPositiveTriangleRejection({
      minimumAnswer: answer,
      verdict: unsupportedFact ? "UNSUPPORTED_PREREQUISITE" : "PASS",
      prerequisiteEvidence: unsupportedFact ? [{ fact: unsupportedFact, kind: "DOMAIN_RULE", source: "UNSUPPORTED", quote: null }] : [],
    }, diagnosticValue === null ? null : { minimumAnswer: answer, diagnosticValue });
    if (accepted) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
});

function assertPartialPropertyAnswer(audit: Pick<z.infer<typeof contentReviewSchema>, "minimumAnswer" | "prerequisiteEvidence">) {
  const answer = audit.minimumAnswer;
  const facts = audit.prerequisiteEvidence.map((item) => item.fact);
  const explicitInsufficiency = /不能(?:确定|确认|判定)|无法(?:确定|确认|判定)|信息不足|不足以|尚不能|还不能|不确定/u.test(answer)
    && /其他角|另一个角|其余角|另外.*角/u.test(answer)
    && /可能|未排除|不能排除|是否/u.test(answer)
    && /直角|90/u.test(answer);
  const requiresConfirmation = /(?:需要|需|要|应|必须)(?:先|进一步)?(?:确认|核对|检查)[^。；]{0,40}直角/u.test(answer)
    && audit.prerequisiteEvidence.some((item) => item.source === "QUESTION"
      && /未(?:能|经)?(?:确认|确定)|无法(?:确认|确定)|信息不足/u.test(item.fact)
      && /三角形/u.test(item.fact) && /直角/u.test(item.fact));
  expect(explicitInsufficiency || requiresConfirmation).toBe(true);
  for (const claim of [answer, ...facts]) {
    expect(claim).not.toMatch(/(?:因此|所以|说明|可知|可判定|意味着)[^。；]{0,16}(?:不是直角三角形|是非直角三角形)/u);
    expect(claim).not.toMatch(/要求(?:所代入的|所涉|所涉及的|已知的?|给定的?)两条边(?:为|是|都为|都是)直角边/u);
    expect(claim).not.toMatch(/(?:已知|给定|这两|所涉|所代入)[^。；]{0,12}(?:必须|只能|都得|应当)(?:是|为)?直角边/u);
  }
}

describe("partial-angle acceptance calibration", () => {
  // Exact excerpts retain the old failures as counterchecks; local artifacts
  // remain untouched. These tests make no provider or network calls.
  const unconfirmed = "题目仅给出两条边的夹角不是直角，未确认该三角形是直角三角形。";
  const confirmationAnswer = "不能直接使用；勾股定理只适用于直角三角形，需先确认三角形为直角三角形并明确直角边与斜边。";
  it.each([
    { source: "07-27-22-526Z: lawful pending confirmation", answer: confirmationAnswer, facts: [unconfirmed], accepted: true },
    { source: "synthetic: explicit unresolved other angle", answer: "无法确定，另一个角仍可能为直角，需要进一步确认。", facts: [unconfirmed], accepted: true },
    { source: "07-15-39-016Z: known sides incorrectly required to be legs", answer: "不能直接使用；勾股定理只适用于直角三角形，要求所代入的两条边为直角边且其夹角为直角。", facts: ["题设给出所讨论的两条边的夹角不是直角。"], accepted: false },
    { source: "07-21-40-554Z: narrow application incorrectly excludes subtraction", answer: "不能直接使用；勾股定理直接应用要求所涉两条边是直角边（夹角为直角），而题设两条边的夹角不是直角，不满足该适用条件。", facts: ["题设中两条边的夹角不是直角。"], accepted: false },
    { source: "synthetic: confirmation wording cannot excuse a whole-object inference", answer: confirmationAnswer, facts: [unconfirmed, "因此该三角形不是直角三角形。"], accepted: false },
    { source: "synthetic: confirmation wording cannot excuse imposed side roles", answer: confirmationAnswer, facts: [unconfirmed, "要求所代入的两条边为直角边。"], accepted: false },
  ])("$source", ({ answer, facts, accepted }) => {
    const check = () => assertPartialPropertyAnswer({
      minimumAnswer: answer,
      prerequisiteEvidence: facts.map((fact) => ({ fact, kind: "READING_ARITHMETIC", source: "QUESTION", quote: "两条边的夹角不是直角" })),
    });
    if (accepted) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
});
const drafts: Array<{
  origin: EvidenceOrigin; scenario: string; requestIndex: number;
} & (
  | { operation: "coach"; content: z.infer<typeof coachDraftSchema> }
  | { operation: "coach_review"; content: z.infer<typeof fixtureReviewSchema> }
  | { operation: "coach_content_review"; content: z.infer<typeof contentReviewSchema> }
)> = [];
const fixtureReviews: Array<{
  origin: "fixed_candidate_real_review"; scenario: string; expected: "reject" | "accept" | "inspect";
  candidate: SourcedCoachTurn; review: z.infer<typeof fixtureReviewSchema> | null;
  contentReview: z.infer<typeof contentReviewSchema> | null;
  injectedGenerationCalls: number; realReviewCalls: number; accepted: boolean | null;
  provenance?: { sourceArtifact: string; sourceScenario: string; changedFields: string[]; objective: string };
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
  expected: "reject" | "accept" | "inspect",
  candidate: SourcedCoachTurn,
  answer: string,
  history: CoachTurnInput["messages"] = [],
  contextTask: CoachTurnInput["task"] = task,
  provenance?: (typeof fixtureReviews)[number]["provenance"],
): Promise<(typeof fixtureReviews)[number]> {
  const record: (typeof fixtureReviews)[number] = { origin: "fixed_candidate_real_review", scenario, expected, candidate, review: null, contentReview: null, injectedGenerationCalls: 0, realReviewCalls: 0, accepted: null, ...(provenance ? { provenance } : {}) };
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
    if (expected === "reject") {
      await expect(operation).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
      record.accepted = false;
    } else if (expected === "inspect") {
      const outcome = await operation.then((output) => ({ output, error: null }), (error: unknown) => ({ output: null, error }));
      if (outcome.output) {
        expect(outcome.output.assistantMessage).toBe(candidate.assistantMessage);
        record.accepted = true;
      } else {
        expect(outcome.error).toMatchObject({ code: "AI_INVALID_OUTPUT" });
        record.accepted = false;
      }
    } else {
      expect((await operation).assistantMessage).toBe(candidate.assistantMessage);
      record.accepted = true;
    }
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
    const previousQuestion = "勾股定理适用于什么样的三角形，依据是什么？";
    const output = await ask("unknown-answer", "不知道", [
      { role: "ASSISTANT", phase: "SOCRATIC", content: previousQuestion, questionType: "CONCEPT_CLARIFICATION" },
    ]);
    expect(output.questionType).toBe("SCAFFOLDED_HINT");
    expect(output.assistantMessage).not.toBe(previousQuestion);
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
    expect(comparison).toMatch(/原来|原先|之前|此前|上次|前一轮|相比|从.{1,80}(?:修正|变|改|转)为/u);
    expect(comparison).toMatch(/现在|这次|明确|修正|补充|转为|变为|改为/u);
    expect(comparison).toMatch(/所有三角形|任意三角形/u);
    expect(comparison).toMatch(/直角三角形/u);
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
        // 07-49-56-127Z correctly said the untaught converse prevented a
        // conclusion from the supplied material. Banning every "不能" conflated
        // unavailable support with mathematical inapplicability. Preserve that
        // failed artifact and calibrate the assertion without accepting false
        // claims about this actually right-angled 3/4/5 triangle.
        assertPositiveTriangleRejection(contentReviewSchema.parse(record.contentReview), record.review);
        // Rejected audit prose is discarded; rejection and diagnosticValue=false
        // are the contract. Only an accepted misconception probe needs a contrast.
      }
  }, 90_000);

  it.each([
    {
      scenario: "observed-ambiguous-rule-validity", expected: "reject" as const,
      topic: "勾股定理条件与应用",
      referenceText: "本次学习范围：在直角三角形中，两条直角边的平方和等于斜边的平方。斜边是直角所对的边。本次不学习逆定理。",
      answer: "我认为所有三角形都可以用勾股定理，只要知道两条边就能求第三条边。",
      question: "在一个三个角分别为50°、60°、70°的具体三角形中，勾股定理是否成立，依据是什么？",
      observation: "你刚才提到所有三角形都可以用勾股定理，还说只要知道两条边就能求第三条边；你还没有说明这个判断依赖的三角形条件。",
      focus: "接下来先试着在这个具体三角形中判断你所说的边长关系是否适用，并指出你依据的是哪条关系。",
      why: "这一步能帮你检验“所有三角形都适用”这一说法在具体情形中是否站得住。",
    },
    {
      scenario: "unsupported-denial-of-antecedent", expected: "reject" as const,
      topic: "条件规则的适用与推断", referenceText: "如果卡片有红色圆点，就允许进入甲通道。没有给出其他准入规则。",
      answer: "没有红色圆点的卡片肯定不能进入甲通道。",
      question: "根据所给规则，一张没有红色圆点的卡片为什么一定不能进入甲通道？",
      observation: "你从没有红色圆点直接判断不能进入，还需要检查这一步推断的依据。",
      focus: "核对这一步判断实际使用了什么条件关系。",
      why: "分清已有规则支持哪些推断，能帮助你避免把缺少依据当作确定结论。",
    },
    {
      scenario: "explicit-rule-applicability", expected: "accept" as const,
      topic: "勾股定理条件与应用",
      referenceText: "本次学习范围：在直角三角形中，两条直角边的平方和等于斜边的平方。斜边是直角所对的边。本次不学习逆定理。",
      answer: "我认为所有三角形都可以用勾股定理，只要知道两条边就能求第三条边。",
      question: "在三个角分别为50°、60°、70°的三角形中，能否直接应用所给的勾股定理，依据是什么？",
      observation: "你认为所有三角形都能直接用这条关系，还需要核对使用它的条件。",
      focus: "在具体情形中核对所给定理能否直接使用。",
      why: "先检查一条规则能否用于当前对象，可以帮助你判断接下来的计算是否有依据。",
    },
    {
      scenario: "disclosed-contrapositive", expected: "reject" as const,
      topic: "条件规则的适用与推断", referenceText: "如果卡片有红色圆点，就允许进入甲通道。",
      answer: "卡片即使没有获准进入甲通道，也可能有红色圆点。",
      question: "一张没有获准进入甲通道的卡片，能有红色圆点吗，依据是什么？",
      observation: "你认为未获准进入的卡片仍可能有红色圆点，需要把这个说法与已有规则对照。",
      focus: "检查这个具体说法能否与所给规则同时成立。",
      // Preserve the original misleading purpose as a negative control instead
      // of discarding the real review's correctly identified answer disclosure.
      why: "核对判断与已有条件关系是否一致，能帮助你找到推断中需要修正的一步。",
    },
    {
      scenario: "supported-contrapositive", expected: "accept" as const,
      topic: "条件规则的适用与推断", referenceText: "如果卡片有红色圆点，就允许进入甲通道。",
      answer: "卡片即使没有获准进入甲通道，也可能有红色圆点。",
      question: "一张没有获准进入甲通道的卡片，能有红色圆点吗，依据是什么？",
      observation: "你认为未获准进入的卡片仍可能有红色圆点，需要把这个说法与已有规则对照。",
      focus: "检查这个具体说法能否与所给规则同时成立。",
      // The 2026-09-29T05:45:43.953Z positive control itself preannounced
      // that the student's binary judgment needed correction. Preserve that
      // failed artifact; this neutral purpose leaves the judgment open.
      why: "核对规则支持哪些推断，能帮助你把判断的依据说清楚。",
    },
    {
      scenario: "supported-extra-direction", expected: "accept" as const,
      topic: "条件规则的适用与推断", referenceText: "如果卡片有红色圆点，就允许进入甲通道。如果卡片被允许进入甲通道，那么它一定有红色圆点。",
      answer: "我认为任何卡片都可以进入甲通道。",
      question: "一张没有红色圆点的卡片可以进入甲通道吗，依据是什么？",
      observation: "你认为所有卡片都可以进入，还需要核对这个判断与已给规则的关系。",
      focus: "用已给的条件关系检验一个具体卡片能否进入。",
      why: "把一般说法放到具体情形中核对，有助于确认它是否得到已有规则支持。",
    },
  ])("conditional-rule real review: $scenario", async (fixture) => {
    // The ambiguous triangle wording and its feedback are the actual output of
    // Render smoke 2026-09-29T05:30:51.196Z. Others are explicit logical controls.
    // Only the draft is injected; both reviews use the configured real model.
    const candidate: SourcedCoachTurn = {
      assistantMessage: fixture.question, questionType: "ASSUMPTION_TEST",
      learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: ["条件推断待核验"], misconceptions: [] },
      nextAction: "ASK_QUESTION", transitionReason: "核验规则的使用范围",
      learningFeedback: { answerQuote: fixture.answer, observation: fixture.observation, focus: fixture.focus, whyItMatters: fixture.why, progress: null },
    };
    const record = await reviewFixedCandidate(fixture.scenario, fixture.expected, candidate, fixture.answer, [], {
      ...task, topic: fixture.topic, objective: "区分规则能否直接应用与结论本身真假；只使用所给关系和数据。", referenceText: fixture.referenceText,
    });
    if (fixture.scenario === "observed-ambiguous-rule-validity") {
      expect(record.contentReview?.conditionalCheck?.questionTarget).toBe("AMBIGUOUS");
      expect(record.realReviewCalls).toBe(1);
    } else if (fixture.scenario === "unsupported-denial-of-antecedent") {
      const audit = record.contentReview;
      expect(record.accepted).toBe(false);
      expect(["UNSUPPORTED_PREREQUISITE", "ANSWER_DISCLOSED"]).toContain(audit?.verdict);
      const check = audit?.conditionalCheck;
      expect(check?.questionTarget).toBe("CONCLUSION_TRUTH");
      expect(check?.inference).toBe("NOT_P_TO_NOT_Q");
      expect(check?.additionalRuleIndices).toEqual([]);
      expect(fixture.question).toContain(check?.questionQuote);
      const rule = check ? audit?.prerequisiteEvidence[check.ruleIndex] : undefined;
      expect(rule?.kind).toBe("DOMAIN_RULE");
      expect(rule?.source).toBe("REFERENCE");
      expect(rule?.quote).toBeTruthy();
      expect(fixture.referenceText).toContain(rule?.quote);
      expect(audit?.minimumAnswer).toMatch(/未给|未说明|没有.*规则|缺少.*(?:规则|依据)|仅(?:有|凭).{0,100}不能(?:证明|推出)/u);
      expect(audit?.minimumAnswer).toMatch(/未知|不能推出|不能证明|无法确定|不能确定/u);
      expect(audit?.minimumAnswer).not.toMatch(/(?:^|[。；;])\s*(?:因此|所以)?(?:一定|必然|肯定)(?:不能|禁止)/u);
      // Multiple real defects may coexist. The primary label may name a
      // disclosure, but correct direction and missing-support reasoning above
      // remain mandatory; an arbitrary rejection or UNSUPPORTED item cannot pass.
      if (audit?.verdict === "ANSWER_DISCLOSED") {
        const disclosure = audit.answerDisclosure;
        expect(disclosure).not.toBeNull();
        const source = disclosure?.field === "question" ? candidate.assistantMessage
          : disclosure ? candidate.learningFeedback?.[disclosure.field] : undefined;
        expect(disclosure?.quote).toBeTruthy();
        expect(source).toContain(disclosure?.quote);
        expect(disclosure?.disclosedAnswer).toMatch(/不能推出|不能确定|无法确定|缺少依据|无依据|未(?:给|说明)/u);
      }
      expect(record.realReviewCalls).toBe(1);
    } else if (fixture.scenario === "disclosed-contrapositive") {
      expect(record.contentReview?.verdict).toBe("ANSWER_DISCLOSED");
      const disclosure = record.contentReview?.answerDisclosure;
      expect(disclosure?.field).toBe("whyItMatters");
      expect(disclosure?.quote).toMatch(/需要修正/u);
      expect(fixture.why).toContain(disclosure?.quote);
      expect(disclosure?.disclosedAnswer).toMatch(/不能|不可能|没有/u);
      expect(record.realReviewCalls).toBe(1);
    } else {
      expect(record.contentReview?.verdict).toBe("PASS");
      expect(record.contentReview?.conditionalCheck).not.toBeNull();
      expect(record.review?.diagnosticValue).toBe(true);
      if (fixture.scenario === "explicit-rule-applicability") {
        expect(record.contentReview?.conditionalCheck?.questionTarget).toBe("RULE_APPLICABILITY");
        expect(record.contentReview?.conditionalCheck?.inference).toBe("APPLICATION_ONLY");
        expect(record.contentReview?.minimumAnswer).toMatch(/不(?:能|可)|未满足|不满足/u);
        expect(record.contentReview?.minimumAnswer).not.toMatch(/平方和不等|平方和不可能|等式(?:必然|一定)?不成立/u);
      }
    }
  }, 150_000);

  it("conditional-rule real review: observed-condition-identification-as-tool", async () => {
    // Preserve the complete real output, including the incorrect internal
    // learner state. No field is rewritten to make this replay easier to reject.
    const fixture = boundaryReplays.records.find((record) => record.scenario === "revision-before");
    expect(fixture).toBeDefined();
    const candidate = coachTurnSchema.parse(fixture?.output);
    const record = await reviewFixedCandidate("observed-condition-identification-as-tool", "reject", candidate, fixture?.answer ?? "", [], task, {
      sourceArtifact: boundaryReplays.sourceArtifact, sourceScenario: "revision-before", changedFields: [], objective: "Replay the complete real draft and verify its condition disclosure is rejected.",
    });
    expect(record.contentReview?.verdict).toBe("ANSWER_DISCLOSED");
    const disclosure = record.contentReview?.answerDisclosure;
    expect(disclosure?.field).toBe("question");
    expect(disclosure?.quote).toMatch(/两直角边|斜边/u);
    expect(candidate.assistantMessage).toContain(disclosure?.quote);
    expect(disclosure?.disclosedAnswer).toMatch(/直角|90/u);
    expect(record.realReviewCalls).toBe(1);
  }, 150_000);

  it("conditional-rule real review: observed-partial-property-to-whole", async () => {
    const fixture = boundaryReplays.records.find((record) => record.scenario === "incorrect-condition");
    expect(fixture).toBeDefined();
    const candidate = coachTurnSchema.parse(fixture?.output);
    const record = await reviewFixedCandidate("observed-partial-property-to-whole", "reject", candidate, fixture?.answer ?? "", [], task, {
      sourceArtifact: boundaryReplays.sourceArtifact, sourceScenario: "incorrect-condition", changedFields: [], objective: "Verify a grounded rejection of this multi-issue draft; a disclosure rejection does not validate scope reasoning.",
    });
    const audit = record.contentReview;
    // 2026-09-29T07:05:55.912Z correctly rejected the original purpose's
    // disclosure but still reasoned incorrectly about the triangle's scope.
    // Retain that failed scope evidence; this unmodified replay now measures
    // only grounded rejection. The neutral-purpose replay below isolates scope.
    if (audit?.verdict === "ANSWER_DISCLOSED") {
      const disclosure = audit.answerDisclosure;
      expect(disclosure).not.toBeNull();
      const source = disclosure?.field === "question" ? candidate.assistantMessage
        : disclosure ? candidate.learningFeedback?.[disclosure.field] : undefined;
      expect(disclosure?.quote).toBeTruthy();
      expect(source).toContain(disclosure?.quote);
      expect(disclosure?.disclosedAnswer).toMatch(/不能|不可|不足|需|条件/u);
    } else {
      const reviewEvidence = [audit?.minimumAnswer, audit?.missingInformationQuote, ...(audit?.prerequisiteEvidence.map((item) => item.fact) ?? []), record.review?.diagnosticRationale].join(" ");
      expect(["AMBIGUOUS_QUESTION", "MISSING_INFORMATION", "UNSUPPORTED_PREREQUISITE"].includes(audit?.verdict ?? "") || record.review?.questionAnswerable === false).toBe(true);
      expect(reviewEvidence).toMatch(/其他角|另一个角|其余角|局部|整体|信息不足|无法确定|不能确定|不足以/u);
    }
  }, 150_000);

  it("conditional-rule real review: isolated-partial-property-to-whole", async () => {
    const fixture = boundaryReplays.records.find((record) => record.scenario === "incorrect-condition");
    expect(fixture).toBeDefined();
    const candidate = coachTurnSchema.parse(fixture?.output);
    candidate.learningFeedback = {
      ...learningFeedbackSchema.parse(candidate.learningFeedback),
      whyItMatters: "核对给定信息支持哪些判断，能帮助你说明使用规则的依据。",
    };
    const record = await reviewFixedCandidate("isolated-partial-property-to-whole", "inspect", candidate, fixture?.answer ?? "", [], task, {
      sourceArtifact: boundaryReplays.sourceArtifact, sourceScenario: "incorrect-condition", changedFields: ["learningFeedback.whyItMatters"], objective: "Isolate scope reasoning with a neutral purpose; the real question and all other candidate fields are unchanged.",
    });
    const audit = record.contentReview;
    // One non-right angle does not settle whether either other angle is right.
    // The 07-27-22-526Z answer lawfully required confirmation, while its QUESTION
    // evidence explicitly said that a right triangle had not been confirmed.
    // Requiring "another angle may be right" verbatim was too narrow. Accept
    // either grounded reading, but preserve checks against the earlier false
    // whole-triangle inference and the requirement that both known sides be legs.
    // This calibrates the assertion; historical failed artifacts are unchanged.
    if (record.accepted) {
      expect(audit?.verdict).toBe("PASS");
      assertPartialPropertyAnswer(contentReviewSchema.parse(audit));
      expect(record.review?.minimumAnswer).toBe(audit?.minimumAnswer);
      expect(record.realReviewCalls).toBe(2);
    } else {
      const reviewEvidence = [audit?.minimumAnswer, audit?.missingInformationQuote, ...(audit?.prerequisiteEvidence.map((item) => item.fact) ?? []), record.review?.diagnosticRationale].join(" ");
      const contentRejectedScope = ["AMBIGUOUS_QUESTION", "MISSING_INFORMATION", "UNSUPPORTED_PREREQUISITE"].includes(audit?.verdict ?? "");
      expect(contentRejectedScope || record.review?.questionAnswerable === false).toBe(true);
      expect(reviewEvidence).toMatch(/其他角|另一个角|其余角|局部|整体|信息不足|无法确定|不能确定|不足以/u);
    }
  }, 150_000);

  it("conditional-rule real review: complete-object-properties-remain-applicable", async () => {
    // Correct but incomplete: a new application need not distinguish an old
    // universal claim which the current student is no longer making.
    const currentAnswer = "我已经知道要先检查三角形的角，不能只凭知道两边就用，但还没解释怎样核对。";
    const candidate: SourcedCoachTurn = {
      assistantMessage: "在三角形ABC中，∠A=60°、∠C=90°，这次能否直接使用勾股定理，依据是什么？",
      questionType: "ASSUMPTION_TEST", learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: ["待说明使用依据"], misconceptions: [] },
      nextAction: "ASK_QUESTION", transitionReason: "核对当前对象的实际条件",
      learningFeedback: { answerQuote: currentAnswer, observation: "你提到要先检查角的条件，还没有说明在具体对象中怎样核对。", focus: "接下来先核对这个三角形的已知条件，并指出实际使用依据。", whyItMatters: "检查给出的全部条件能帮助你说明判断依据，而不只凭其中一个局部特征。", progress: null },
    };
    const record = await reviewFixedCandidate("complete-object-properties-remain-applicable", "accept", candidate, currentAnswer);
    expect(record.contentReview?.minimumAnswer).toMatch(/能|可以|可直接/u);
    expect(record.contentReview?.minimumAnswer).toMatch(/∠?C|90|直角/u);
    expect(record.contentReview?.prerequisiteEvidence.every((item) => item.source !== "UNSUPPORTED")).toBe(true);
    expect(record.review?.questionAnswerable).toBe(true);
  }, 150_000);

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
