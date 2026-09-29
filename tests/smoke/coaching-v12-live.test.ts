import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { resetServerEnvForTests } from "@/lib/env";
import { learningFeedbackSchema, type LearningFeedback } from "@/lib/learning-feedback";
import { buildAssessmentRules } from "@/lib/knowledge/assessment-context";
import { diagnoseCoaching, prepareCoaching, recordCoaching } from "@/lib/knowledge/coaching";
import type { CoachingDecision } from "@/lib/knowledge/coaching-schema";
import { initialKnowledgeRuntime } from "@/lib/knowledge/orchestrator";
import { createVersionSnapshot } from "@/lib/knowledge/releases";
import { applyV12Assessment } from "@/lib/knowledge/v12-engine";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import type { TurnAssessment } from "@/lib/knowledge/v12-schema";
import { createTeachingOutputSchema, teachingReviewSchema, type TeachingSelection } from "@/lib/ai/teaching-schema";
import { teachingReviewPrompt, teachingV12Prompt } from "@/lib/ai/prompts/teaching-v12";

// Only the usage-log sink is replaced. Model HTTP calls, evidence extraction,
// server assessment and teaching selection/review all execute their real code.
const telemetry = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db", () => ({ prisma: { aIUsage: {
  create: async (input: { data: Record<string, unknown> }) => {
    telemetry.calls.push(input.data);
    return { id: `live-v12-usage-${telemetry.calls.length}`, ...input.data };
  },
} } }));

config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const selectionDraftSchema = z.object({ followUp: z.object({ question: z.string(), studentAnchor: z.string(), sourceIds: z.array(z.string()) }) });
const selectionDrafts: Array<{ draft: z.infer<typeof selectionDraftSchema>; issues: Array<{ path: string; message: string }> }> = [];
const records: Array<{
  scenario: string;
  answer: string;
  assessment?: TurnAssessment;
  teachingDecision?: CoachingDecision;
  assistantMessage?: string;
  learningFeedback?: LearningFeedback;
  contractChecksPassed?: boolean;
  reviewerOutputs?: Array<z.infer<typeof teachingReviewSchema>>;
  expectedReview?: "REJECT_BOUNDARY_DISCLOSURE" | "ACCEPT_MECHANISM_BACKGROUND";
}> = [];

describe.skipIf(!enabled)("DeepSeek live v1.2 coaching feedback", () => {
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
    const artifactPath = `.data/coaching-live/v12-recheck-${generatedAt.replace(/[:.]/gu, "-")}.json`;
    await writeFile(artifactPath, JSON.stringify({
      generatedAt,
      evidenceScope: "合成学生回答的真实 v1.2 模型诊断、服务端判定与教学追问验证，不代表真实教学成效或生产验收。",
      model: process.env.DEEPSEEK_MODEL,
      databaseWrites: "仅将 usage telemetry 缓存在此文件，不写入用户数据库。首例全链调用真实模型；固定对照只注入待审候选题，独立教学审核仍调用真实模型。",
      records,
      selectionDrafts,
      usage: telemetry.calls,
    }, null, 2), "utf8");
    vi.unstubAllEnvs();
    resetServerEnvForTests();
  });

  it("explains and probes an explicit direct-link misconception using the actual assessed answer", async () => {
    const manifest = buildV12Manifest();
    const runtime = initialKnowledgeRuntime(createVersionSnapshot(manifest));
    const target = manifest.knowledgeUnits.find((unit) => unit.id === "M_SR_002")!;
    const group = manifest.questionGroups.find((item) => item.targetId === target.id)!;
    const question = manifest.socraticQuestions.find((item) => item.id === group.memberIds[0])!;
    runtime.currentTargetId = target.id;
    runtime.currentQuestionId = question.id;
    runtime.v12!.pedagogicalStage = "KNOWLEDGE_CONSTRUCTION";
    runtime.v12!.currentGroupId = group.id;
    const message = { id: "live-v12-direct-link-answer", content: "只有直接债权债务联系才会传播系统性风险" };
    const reviewerOutputs: Array<z.infer<typeof teachingReviewSchema>> = [];
    let teachingInput: TeachingSelection | null = null;
    const provider = new DeepSeekProvider({ fetcher: async (url, init) => {
      const request = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(String(init?.body)));
      const result = await fetch(url, init);
      if (result.ok && teachingInput && request.messages[0].content.startsWith(teachingV12Prompt)) {
        try {
          const body = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) }).parse(await result.clone().json());
          const content: unknown = JSON.parse(body.choices[0].message.content);
          const draft = selectionDraftSchema.safeParse(content);
          const validated = createTeachingOutputSchema(teachingInput).safeParse(content);
          if (draft.success) selectionDrafts.push({ draft: draft.data, issues: validated.success ? [] : validated.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
        } catch {
          // Observe only schema-selected synthetic drafts; the provider decides errors.
        }
      }
      if (result.ok && request.messages[0].content.startsWith(teachingReviewPrompt)) {
        const body = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) }).parse(await result.clone().json());
        reviewerOutputs.push(teachingReviewSchema.parse(JSON.parse(body.choices[0].message.content)));
      }
      return result;
    } });
    const assessment = await provider.assessLearningTurn({
      requestId: "live-v12-direct-link-assessment",
      message,
      lockedContext: {
        phase: "SOCRATIC", stage: "KNOWLEDGE_CONSTRUCTION", targetId: target.id, questionId: question.id,
        caseId: null, action: "ASSESS_EVIDENCE", hintLevel: 0, releaseId: manifest.release.id, questionText: question.questionText,
      },
      evaluationRules: buildAssessmentRules(manifest, runtime),
      evidenceDefinitions: manifest.v12!.evidenceDefinitions,
      aliases: manifest.v12!.aliases,
      candidateTargets: { misconceptionIds: Object.keys(manifest.v12!.errors), gapIds: Object.keys(manifest.v12!.gaps) },
      knowledgeUnits: manifest.knowledgeUnits.filter((unit) => unit.id === target.id || target.prerequisites.includes(unit.id)).slice(0, 4).map(({ id, content }) => ({ id, content })),
    });
    const record: typeof records[number] = { scenario: "direct-link-only-misconception", answer: message.content, assessment, reviewerOutputs };
    records.push(record);
    expect(assessment.evidence.map((item) => item.evidenceId)).toContain("direct_link_only");
    expect(assessment.evidence.map((item) => item.evidenceId)).not.toContain("no_direct_link_required");
    for (const item of assessment.evidence) {
      expect(item.messageId).toBe(message.id);
      expect(message.content).toContain(item.extractedText);
    }
    const now = new Date().toISOString();
    const assessed = applyV12Assessment(manifest, runtime, assessment, message, now);
    const profile = diagnoseCoaching(manifest, assessed, "有基础");
    const prepared = prepareCoaching(manifest, assessed, {
      kind: "QUESTION", content: question.questionText, learnerLevel: "有基础", profile,
      studentContent: message.content, answerMessageId: message.id,
      recentTurns: [{ role: "ASSISTANT", content: question.questionText }],
    });
    teachingInput = prepared.input;
    const decision = await provider.selectTeachingMove({ ...prepared.input, requestId: "live-v12-direct-link-teaching" });
    record.teachingDecision = decision;
    const presented = recordCoaching(assessed, prepared, decision, { requestId: "live-v12-direct-link-teaching", now });
    record.assistantMessage = presented.assistantMessage;
    record.learningFeedback = presented.learningFeedback;
    const feedback = learningFeedbackSchema.parse(presented.learningFeedback);
    expect(message.content).toContain(feedback.answerQuote);
    expect(feedback.observation).toContain("必要条件");
    expect(feedback.focus).toMatch(/成立条件|是否仍然成立|边界|核实|澄清/u);
    expect(feedback.whyItMatters).toMatch(/判断|推理|依据/u);
    expect(feedback.whyItMatters).toContain("传播途径");
    expect(feedback.progress).toBeNull();
    expect(decision.followUp).toBeDefined();
    expect(message.content).toContain(decision.followUp!.studentAnchor);
    expect(presented.assistantMessage).toBe(decision.followUp!.question);
    expect(presented.assistantMessage).toMatch(/直接|债权|借贷|传播|联系|共同|资产/u);
    expect(presented.assistantMessage).toMatch(/[?？]/u);
    expect(presented.runtime.v12!.coachingHistory.at(-1)?.decisionBasis?.basisMessageId).toBe(message.id);
    expect(JSON.stringify({ feedback, question: presented.assistantMessage })).not.toMatch(/(?:C|M|DQ|SQ|ERR|GAP)_SR_|COACH_|direct_link_only|no_direct_link_required|modelConfidence|FLAG_/u);
    expect(telemetry.calls.map((item) => item.operation)).toEqual(expect.arrayContaining(["turn_assessment", "teaching_selection", "teaching_review"]));
    record.contractChecksPassed = true;
  }, 240_000);

  it("rejects a fixed disclosed boundary answer but accepts supplied background for a mechanism target", async () => {
    const manifest = buildV12Manifest();
    const misconception = "只有直接债权债务联系才会传播系统性风险";
    const disclosure = `你提到“${misconception}”，如果两家机构之间没有直接借贷，但都持有同类资产，那么同一价格冲击会通过什么过程让它们同时受损？`;
    const mechanismAnswer = "共同持仓的机构可能同时受损，随后它们一起卖出资产。";
    const mechanismQuestion = "你提到“共同持仓的机构可能同时受损”，假设没有直接借贷的两家机构已经因共同持仓遭受损失，随后集中出售这些资产，出售行为会怎样影响市场价格？";
    for (const scenario of [
      { scenario: "fixed-boundary-disclosure", targetId: "M_SR_002", evidenceId: "no_direct_link_required", answer: misconception, question: disclosure, anchor: misconception, expectedReview: "REJECT_BOUNDARY_DISCLOSURE" as const },
      { scenario: "fixed-mechanism-background", targetId: "M_SR_003", evidenceId: "price_decline", answer: mechanismAnswer, question: mechanismQuestion, anchor: "共同持仓的机构可能同时受损", expectedReview: "ACCEPT_MECHANISM_BACKGROUND" as const },
    ]) {
      const record: typeof records[number] = { scenario: scenario.scenario, answer: scenario.answer, assistantMessage: scenario.question, expectedReview: scenario.expectedReview, reviewerOutputs: [] };
      records.push(record);
      const selection: TeachingSelection = {
        kind: "QUESTION", profile: { targetId: scenario.targetId, level: "L2", dimension: scenario.expectedReview === "REJECT_BOUNDARY_DISCLOSURE" ? "CONCEPT" : "MECHANISM", reasonId: "COACH_FILL_GAP", observedEvidenceIds: scenario.expectedReview === "REJECT_BOUNDARY_DISCLOSURE" ? ["direct_link_only"] : ["concentrated_or_forced_sale"], missingEvidenceIds: [scenario.evidenceId], basisMessageId: "fixed-review-answer", verifiedLevel: false },
        standard: `本题仅核验：${manifest.v12!.evidenceDefinitions[scenario.evidenceId]}`,
        choices: [{ id: "FIXED_REVIEW_FORM", purpose: "当前缺口", template: "围绕当前缺口继续判断并说明依据。" }],
        openings: [{ id: "OPEN_DIRECT", text: "" }], studentContent: scenario.answer,
        grounding: { targetId: scenario.targetId, targetTitle: manifest.knowledgeUnits.find((unit) => unit.id === scenario.targetId)!.title,
          requirements: { requiredAll: [scenario.evidenceId], requiredAny: [], prohibited: [] },
          sources: [{ id: scenario.targetId, text: manifest.knowledgeUnits.find((unit) => unit.id === scenario.targetId)!.content }, { id: scenario.evidenceId, text: manifest.v12!.evidenceDefinitions[scenario.evidenceId] }],
          instructions: ["只核验当前锁定缺口；不得在题干中给出待判断结论。"], maxQuestionChars: 360 },
      };
      const provider = new DeepSeekProvider({ fetcher: async (url, init) => {
        const request = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) }).parse(JSON.parse(String(init?.body)));
        if (request.messages[0].content.startsWith(teachingReviewPrompt)) {
          const reviewed = await fetch(url, init);
          if (reviewed.ok) {
            const body = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) }).parse(await reviewed.clone().json());
            record.reviewerOutputs!.push(teachingReviewSchema.parse(JSON.parse(body.choices[0].message.content)));
          }
          return reviewed;
        }
        // The candidate is deliberately fixed to compare the real reviewer's
        // handling of two different curricular requirements on similar facts.
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ choiceId: "FIXED_REVIEW_FORM", openingId: "OPEN_DIRECT", followUp: { question: scenario.question, studentAnchor: scenario.anchor, sourceIds: [scenario.targetId, scenario.evidenceId] } }) } }] }), { status: 200 });
      } });
      const selected = provider.selectTeachingMove({ ...selection, requestId: `live-v12-${scenario.scenario}` });
      if (scenario.expectedReview === "REJECT_BOUNDARY_DISCLOSURE") {
        await expect(selected).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
        expect(record.reviewerOutputs!.length).toBeGreaterThan(0);
        expect(record.reviewerOutputs!.every((review) => review.requirementChecks.find((check) => check.evidenceId === "no_direct_link_required")?.status === "PROVIDED")).toBe(true);
        expect(record.reviewerOutputs!.every((review) => review.answerLeakQuote !== null)).toBe(true);
      } else {
        expect((await selected).followUp?.question).toBe(scenario.question);
        expect(record.reviewerOutputs!.at(-1)?.answerLeakQuote).toBeNull();
        expect(record.reviewerOutputs!.at(-1)?.requirementChecks.find((check) => check.evidenceId === "price_decline")?.status).toBe("ELICITED");
      }
      record.contractChecksPassed = true;
    }
  }, 240_000);
});
