import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { DeepSeekProvider } from "@/lib/ai/deepseek-provider";
import { createSessionInputSchema, coachTurnSchema } from "@/lib/contracts";
import { resetServerEnvForTests } from "@/lib/env";
import { triangleConstraintsSchema, validateTriangleConstraints } from "@/lib/ai/triangle-constraints";
import { buildDisclosureAuditInput, validateDisclosureAudit } from "@/lib/ai/answer-disclosure-audit";

const telemetry = vi.hoisted(() => ({ usage: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db", () => ({ prisma: { aIUsage: { create: async (input: { data: Record<string, unknown> }) => {
  telemetry.usage.push(input.data); return { id: `content-calibration-${telemetry.usage.length}`, ...input.data };
} } } }));
config({ path: [".env.local", ".env"], quiet: true });
const enabled = process.env.RUN_DEEPSEEK_LIVE_TEST === "true" && process.env.RUN_COACH_CONTENT_CALIBRATION === "true" && Boolean(process.env.DEEPSEEK_API_KEY);
const modeSchema = z.enum(["baseline", "low", "production"]);
const modes = (process.env.CONTENT_CALIBRATION_MODES ?? "production").split(",").map((mode) => modeSchema.parse(mode));
const mathTask = createSessionInputSchema.parse({ topic: "勾股定理的适用条件", objective: "核对具体条件并说明适用依据", learnerLevel: "入门", referenceText: "勾股定理适用于直角三角形，两条直角边的平方和等于斜边的平方；斜边是直角所对的边。" });
const dataTask = createSessionInputSchema.parse({ topic: "相关与因果", objective: "区分共同变化和因果解释", learnerLevel: "入门", referenceText: "两个量一起变化只能说明相关，不能单凭这一点确定因果。第三个因素可能同时影响两者。例如炎热天气可能同时增加冰淇淋销量和游泳人数。观察记录不是随机分配的实验。" });
const wrongData = "冰淇淋销量和游泳人数一起增加，所以一定是买冰淇淋使人去游泳。";
const wrongMath = "任何三角形只要知道两条边，就能用勾股定理求第三条边。";
const cases = [
  { id: "observed-data-answer-disclosure", task: dataTask, answer: wrongData, expected: "ANSWER_DISCLOSED", question: "某地连续高温，冰淇淋销量和游泳人数都上升；调查发现人们去游泳是因为天气炎热，并不是因为买了冰淇淋。仅凭“两者一起上升”这一观察，能否证明买冰淇淋使人去游泳，依据是什么？", focus: "先用这个具体情形判断：同步上升本身是否足以支持该因果结论", observation: "你刚才提到两个量一起增加，并据此得出一定是买冰淇淋使人去游泳。" },
  { id: "observed-incompatible-triangle", task: mathTask, answer: wrongMath, expected: "INCONSISTENT_GIVENS", question: "一个三角形的三个角分别为50°、60°、70°，已知其中两条边长分别为3和4，能否直接用勾股定理求第三边，依据是什么？", focus: "检验一个具体情形", observation: "你把适用对象说成了任何三角形。" },
  { id: "neutral-data-evidence", task: dataTask, answer: wrongData, expected: "PASS", question: "某地连续高温，冰淇淋销量和游泳人数同时上升；记录没有对人群作随机分配。仅凭这份记录，能否证明买冰淇淋使人去游泳，依据是什么？", focus: "检验这份记录能支持哪种解释", observation: "你用两个量同时增加解释了因果方向。" },
  { id: "consistent-triangle", task: mathTask, answer: wrongMath, expected: "PASS", question: "一个三角形三个角均为60°，其中两条边均长3，能否直接用勾股定理求第三边，依据是什么？", focus: "检验具体对象是否满足使用条件", observation: "你认为知道任意三角形的两条边就足以使用这个定理。" },
  { id: "given-tool-new-calculation", task: mathTask, answer: "我知道直角三角形可以使用勾股定理，但还没有算过具体的边长。", expected: "PASS", question: "一个直角三角形的两条直角边长为3和4，利用a²+b²=c²求斜边长，你的计算过程是什么？", focus: "用已经明确的关系完成一次计算", observation: "你已经指出适用条件，还没有展示具体代入过程。" },
  { id: "student-known-direction-new-reason", task: dataTask, answer: "共同变化不足以确定因果，我还不知道应考虑什么其他解释。", expected: "PASS", question: "某地高温期间，冰淇淋销量和游泳人数同时上升；你已经指出共同变化不够，在这个情形中哪个具体因素可能同时影响二者？", focus: "找出当前情形中的一个共同因素", observation: "你已区分共同变化与因果，接下来还需要给出具体的替代解释。" },
  { id: "observed-claim-truth-evaporation", task: createSessionInputSchema.parse({ topic: "蒸发与温度", objective: "通过日常现象说明水在未沸腾时也能蒸发，并区分蒸发和沸腾", learnerLevel: "入门", referenceText: "蒸发发生在液体表面，水未沸腾时也能发生。排除漏水、泼洒后，敞口杯水量减少可以用蒸发解释。" }), answer: "我觉得水只有烧开才会变少。", expected: "PASS", question: "一杯敞口的水放在室温下，既没有洒出也没有漏水，几天后水位下降了，你认为这杯水变少是否一定需要先烧开，依据是什么？", focus: "用未加热敞口水杯水位下降的情形检验“只有烧开才变少”这一判断。", observation: "你刚才提到你认为水只有烧开才会变少，这是你目前对水量减少条件的判断。" },
  { id: "definition-containing-answer", task: mathTask, answer: "我还不知道使用勾股定理时两条边的夹角有什么要求。", expected: "ANSWER_DISCLOSED", question: "要使用勾股定理，这两条直角边之间应是什么角？", focus: "说出需要的夹角条件", observation: "你还没有说明夹角条件。" },
  { id: "implicit-negative-direction", task: dataTask, answer: wrongData, expected: "ANSWER_DISCLOSED", question: "仅依据两者共同增加就确定是买冰淇淋导致游泳，这个判断成立吗？", focus: "找到这个因果推断中需要修正的一步", observation: "你根据共同变化提出了因果解释。" },
] as const;
const jsonSchema = z.json();
type Json = z.infer<typeof jsonSchema>;
const records: Array<{ mode: string; id: string; expected: string; input: Json; candidate: Json; accepted: boolean | null; error: string | null; requests: Array<{ operation: string; elapsedMs: number; status: number; finishReason: string | null; content: Json | null; completionTokens: number | null }> }> = [];

describe.skipIf(!enabled)("real focused content-review calibration", () => {
  beforeAll(() => {
    vi.stubEnv("AI_PROVIDER", "deepseek"); vi.stubEnv("DEPLOYMENT_ENV", "test");
    vi.stubEnv("DEEPSEEK_WEB_SEARCH_FALLBACK", "false"); vi.stubEnv("AI_MAX_RETRIES", "0");
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "60000"); resetServerEnvForTests();
  });
  afterAll(async () => {
    await mkdir(".data/coaching-live", { recursive: true });
    const date = new Date().toISOString();
    await writeFile(`.data/coaching-live/content-quality-${date.replace(/[:.]/gu, "-")}.json`, JSON.stringify({ date, model: process.env.DEEPSEEK_MODEL, scope: "Fixed synthetic candidates; generation is injected, all content/teaching audits are real HTTP calls. Small engineering calibration, not teacher certification.", records, usage: telemetry.usage }, null, 2));
    vi.unstubAllEnvs(); resetServerEnvForTests();
  });
  for (const mode of modes) for (const fixture of cases) it(`${mode}: ${fixture.id}`, async () => {
    const candidate = coachTurnSchema.parse({ assistantMessage: fixture.question, questionType: "EVIDENCE_PROBE", learnerState: { masteryEstimate: 0, confirmedPoints: [], gaps: [], misconceptions: [] }, nextAction: "ASK_QUESTION", transitionReason: "检验当前最小缺口", learningFeedback: { answerQuote: fixture.answer, observation: fixture.observation, focus: fixture.focus, whyItMatters: "这能帮你核对所用依据是否足以支持自己的判断。", progress: null } });
    const input = { task: fixture.task, phase: "SOCRATIC" as const, socraticTurns: 0, maxTurns: 5, unknownStreak: 0, learnerState: null, latestAnswer: fixture.answer, messages: [{ role: "USER" as const, phase: "SOCRATIC" as const, content: fixture.answer, questionType: null }], knowledgePolicy: "MODEL_FALLBACK" as const };
    const record: (typeof records)[number] = { mode, id: fixture.id, expected: fixture.expected, input: jsonSchema.parse(input), candidate: jsonSchema.parse(candidate), accepted: null, error: null, requests: [] };
    records.push(record);
    const fetcher: typeof fetch = async (url, init) => {
      const body = z.record(z.string(), z.unknown()).parse(JSON.parse(String(init?.body)));
      const messages = z.array(z.object({ role: z.string(), content: z.string() })).parse(body.messages);
      const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
      const operation = system.includes("你是独立的答案暴露检查员") ? "disclosure" : system.includes("你是学习内容可用性复核模块") ? "content" : system.includes("你是学习反馈质量复核模块") ? "teaching" : "generation";
      if (operation === "generation") return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }] }), { status: 200 });
      if (operation === "content" && mode === "low") { body.thinking = { type: "enabled" }; body.reasoning_effort = "low"; body.max_tokens = 6000; delete body.temperature; }
      if (operation === "content" && mode === "baseline") { body.thinking = { type: "disabled" }; delete body.reasoning_effort; body.max_tokens = 2500; body.temperature = 0; }
      const started = performance.now();
      const response = await fetch(url, { ...init, body: JSON.stringify(body) });
      const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable() }) })), usage: z.object({ completion_tokens: z.number().optional() }).optional() }).safeParse(await response.clone().json());
      let content: Json | null = null;
      if (envelope.success && envelope.data.choices[0]?.message.content) try { content = jsonSchema.parse(JSON.parse(envelope.data.choices[0].message.content)); } catch { /* Retain missing parsed output with finish reason. */ }
      record.requests.push({ operation, elapsedMs: Math.round(performance.now() - started), status: response.status, finishReason: envelope.success ? envelope.data.choices[0]?.finish_reason ?? null : null, content, completionTokens: envelope.success ? envelope.data.usage?.completion_tokens ?? null : null });
      return response;
    };
    try { await new DeepSeekProvider({ fetcher }).createCoachTurn(input); record.accepted = true; }
    catch (error) { record.accepted = false; record.error = error instanceof Error ? error.message : "UNKNOWN"; }
    const audit = z.object({ verdict: z.string() }).parse(record.requests.find((request) => request.operation === "content")?.content);
    if (mode === "production" && fixture.id === "observed-incompatible-triangle") {
      const extracted = z.object({ triangleConstraints: triangleConstraintsSchema }).parse(record.requests.find((request) => request.operation === "content")?.content);
      expect(validateTriangleConstraints(extracted.triangleConstraints, fixture.question).status).toBe("CONFLICT");
    } else if (mode === "production" && fixture.expected === "ANSWER_DISCLOSED") {
      const disclosure = record.requests.find((request) => request.operation === "disclosure");
      const checked = disclosure ? validateDisclosureAudit(disclosure.content, buildDisclosureAuditInput(candidate.assistantMessage, candidate.learningFeedback!, [fixture.answer])) : null;
      expect(audit.verdict === "ANSWER_DISCLOSED" || checked?.verdict === "ANSWER_DISCLOSED").toBe(true);
    } else expect(audit.verdict).toBe(fixture.expected);
    if (fixture.expected !== "PASS") expect(record.accepted).toBe(false);
    if (fixture.expected === "PASS") expect(record.accepted).toBe(true);
  }, 150_000);
});
