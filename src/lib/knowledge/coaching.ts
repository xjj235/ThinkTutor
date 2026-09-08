import type { KnowledgeManifest } from "./schemas";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { EvidenceRule } from "./v12-schema";
import { activeRule, baseV12Rule, aggregateDiagnosticLevel } from "./v12-engine";
import { coachingProfileSchema, type CoachingDecision, type CoachingKind, type CoachingProfile } from "./coaching-schema";
import { createTeachingDecisionSchema, teachingSelectionInputSchema, type TeachingSelection } from "../ai/teaching-schema";
import type { QuestionType } from "../contracts";

export interface CoachingOptions {
  kind: CoachingKind;
  content: string;
  learnerLevel: string;
  studentContent?: string;
  profile?: CoachingProfile;
  recentTurns?: TeachingSelection["recentTurns"];
}
export interface PreparedCoaching {
  input: TeachingSelection;
  dimensionLabel: string;
  choices: Array<{ id: string; template: string; rule: EvidenceRule | null; questionType?: QuestionType; framed: boolean }>;
  content: string;
}

export function diagnoseCoaching(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, learnerLevel: string): CoachingProfile {
  const policy = manifest.v12!.coachingPolicy!;
  const state = runtime.v12!;
  const messageId = state.lastAssessmentMessageId;
  const assessment = messageId ? state.assessments[messageId] : undefined;
  const observed = assessment?.evidence.map((e) => e.evidenceId) ?? [];
  const rule = runtime.currentTargetId ? activeRule(manifest, runtime) : null;
  const missing = rule ? [...rule.requiredAll.filter((id) => !observed.includes(id)), ...(!rule.requiredAny.some((id) => observed.includes(id)) ? rule.requiredAny : [])] : [];
  let signal: "UNRELIABLE" | "MISCONCEPTION" | "MISSING" | "VERIFY" | "INITIAL" = !assessment ? "INITIAL" : state.lastResult === "NEED_VERIFY" ? "UNRELIABLE" : rule?.prohibited.some((id) => observed.includes(id)) ? "MISCONCEPTION" : missing.length ? "MISSING" : "VERIFY";
  // A correct definition still needs an independent condition check before mastery.
  if (signal === "VERIFY" && ["C_SR_001", "M_SR_003"].includes(runtime.currentTargetId!) && !observed.includes("condition_revision") && state.unitStates[runtime.currentTargetId!]?.status !== "MASTERED") {
    missing.push("condition_revision"); signal = "MISSING";
  }
  const dimension = signal === "UNRELIABLE" ? "EVIDENCE" : signal === "MISCONCEPTION" ? "CONCEPT"
    : policy.dimensionPriority.find((d) => missing.some((id) => policy.dimensions[d].evidenceIds.includes(id)))
      ?? (signal === "VERIFY" ? "TRANSFER" : "CONCEPT");
  return coachingProfileSchema.parse({ targetId: runtime.currentTargetId, level: assessment ? aggregateDiagnosticLevel(state) : learnerLevel === "进阶" ? "L3" : learnerLevel === "有基础" ? "L2" : "L1", dimension, reasonId: policy.routingRules.find((r) => r.signal === signal)!.id, observedEvidenceIds: observed, missingEvidenceIds: [...new Set(missing)], basisMessageId: messageId, verifiedLevel: Boolean(state.diagnosticLevel) });
}

export function prepareCoaching(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, options: CoachingOptions): PreparedCoaching {
  const policy = manifest.v12?.coachingPolicy;
  if (!policy || !runtime.v12) throw new Error("Coaching requires a versioned knowledge policy");
  let profile = options.profile ?? diagnoseCoaching(manifest, runtime, options.learnerLevel);
  const sameTarget = profile.targetId === runtime.currentTargetId;
  if (!sameTarget) profile = { ...profile, targetId: runtime.currentTargetId, reasonId: "COACH_INITIAL_SCOPE", missingEvidenceIds: [] };
  const target = manifest.knowledgeUnits.find((u) => u.id === runtime.currentTargetId)?.title
    ?? manifest.v12!.competencies.find((u) => u.id === runtime.currentTargetId)?.description ?? manifest.knowledgePoint.title;
  const rule = runtime.currentTargetId ? baseV12Rule(manifest, runtime) : null;
  let choices: PreparedCoaching["choices"] = policy.stageFrames[options.kind].map((frame) => ({ ...frame, rule, framed: true }));
  if (["DIAGNOSIS", "QUESTION"].includes(options.kind) && sameTarget && profile.reasonId !== "COACH_INITIAL_SCOPE" && rule && !runtime.v12.currentCaseId && !runtime.currentQuestionId?.startsWith("CASE_VERIFY_")) {
    const focusedIds = profile.missingEvidenceIds.filter((id) => policy.dimensions[profile.dimension].evidenceIds.includes(id));
    const needsIntegratedVerification = profile.reasonId === "COACH_VERIFY_INDEPENDENT" && ["C_SR_001", "M_SR_003"].includes(runtime.currentTargetId!) && runtime.v12.unitStates[runtime.currentTargetId!]?.status !== "MASTERED";
    const scopedRule: EvidenceRule = focusedIds.length ? {
      requiredAll: focusedIds.filter((id) => rule.requiredAll.includes(id) || id === "condition_revision"),
      requiredAny: focusedIds.filter((id) => rule.requiredAny.includes(id)), prohibited: rule.prohibited,
    } : needsIntegratedVerification ? { ...rule, requiredAll: [...new Set([...rule.requiredAll, "condition_revision"])] } : rule;
    const forms = policy.forms.filter((f) => f.dimension === profile.dimension && f.levels.includes(profile.level));
    choices = forms.map((form) => ({ id: form.id, template: form.template.replaceAll("{target}", target), rule: scopedRule, questionType: form.questionType, framed: false }));
  }
  const history = runtime.v12.coachingHistory.filter((h) => h.kind === options.kind && h.profile.targetId === profile.targetId);
  const unused = choices.filter((c) => !history.some((h) => h.choiceId === c.id));
  if (unused.length) choices = unused;
  else {
    const lastIndex = (id: string) => history.map((h) => h.choiceId).lastIndexOf(id);
    choices.sort((a, b) => lastIndex(a.id) - lastIndex(b.id));
    if (choices.length > 1) choices = choices.filter((c) => c.id !== history.at(-1)?.choiceId);
  }
  const scopedRule = choices[0]?.rule;
  const generation = policy.generation;
  const dynamic = Boolean(generation && options.studentContent?.trim() && choices.every((c) => !c.framed) && !runtime.v12.currentCaseId && !runtime.currentQuestionId?.startsWith("CASE_VERIFY_") && scopedRule && (scopedRule.requiredAll.length || scopedRule.requiredAny.length));
  const unit = manifest.knowledgeUnits.find((u) => u.id === runtime.currentTargetId);
  const grounding = dynamic ? {
    targetId: runtime.currentTargetId!, targetTitle: target, requirements: scopedRule!,
    sources: [
      ...manifest.knowledgeUnits.filter((u) => u.id === unit?.id || unit?.prerequisites.includes(u.id)).slice(0, 4).map((u) => ({ id: u.id, text: u.content })),
      ...[...new Set([...scopedRule!.requiredAll, ...scopedRule!.requiredAny, ...scopedRule!.prohibited])].map((id) => ({ id, text: manifest.v12!.evidenceDefinitions[id] })),
    ],
    instructions: generation!.instructions, maxQuestionChars: generation!.maxQuestionChars,
  } : undefined;
  const input = teachingSelectionInputSchema.parse({
    kind: options.kind, profile,
    standard: `${policy.levelCriteria[profile.level]}\n${policy.dimensions[profile.dimension].criterion}\n${policy.routingRules.find((r) => r.id === profile.reasonId)!.description}`,
    choices: choices.map((c) => ({ id: c.id, purpose: policy.forms.find((f) => f.id === c.id)?.label ?? options.kind, template: c.template })),
    openings: policy.openings,
    studentContent: options.studentContent ?? "",
    grounding,
    recentTurns: options.recentTurns?.slice(-(generation?.recentTurnLimit ?? 6)).map((turn) => ({ ...turn, content: turn.content.slice(0, 2000) })),
    previousQuestions: [...new Set([...history.flatMap((h) => h.followUp ? [h.followUp.question] : []), ...(runtime.v12.coachingPrompt ? [runtime.v12.coachingPrompt.text] : [])])].slice(-8),
  });
  return { input, choices, content: options.content, dimensionLabel: policy.dimensions[profile.dimension].label };
}

export function recordCoaching(runtime: KnowledgeRuntime, prepared: PreparedCoaching, decision: CoachingDecision, meta: { requestId: string; now: string }, content = prepared.content) {
  const valid = createTeachingDecisionSchema(prepared.input).parse(decision);
  const choice = prepared.choices.find((c) => c.id === valid.choiceId)!;
  const opening = prepared.input.openings.find((o) => o.id === valid.openingId)!.text;
  const question = valid.followUp?.question ?? (choice.framed ? choice.template.replace("{content}", () => content) : choice.template);
  const next = structuredClone(runtime);
  next.v12!.coachingHistory.push({ kind: prepared.input.kind, profile: prepared.input.profile, ...valid, questionId: runtime.currentQuestionId, caseId: runtime.v12!.currentCaseId, provider: runtime.versions.modelProvider, model: runtime.versions.modelName, requestId: meta.requestId, createdAt: meta.now });
  if (["DIAGNOSIS", "QUESTION", "CASE", "FEYNMAN", "REFLECTION", "RESUME"].includes(prepared.input.kind) && choice.rule && (prepared.input.kind !== "RESUME" || runtime.v12!.resumeVerification)) {
    next.v12!.coachingPrompt = { questionId: runtime.currentQuestionId, stage: runtime.v12!.pedagogicalStage, text: question, rule: choice.rule };
  }
  const focus = ["DIAGNOSIS", "QUESTION"].includes(prepared.input.kind) && prepared.input.profile.reasonId !== "COACH_INITIAL_SCOPE" ? `追问焦点：${prepared.dimensionLabel}` : "";
  return { runtime: next, assistantMessage: valid.followUp ? question : [opening, focus, question].filter(Boolean).join("\n\n"), questionType: choice.questionType };
}
