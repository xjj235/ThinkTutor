import type { KnowledgeManifest } from "./schemas";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { EvidenceRule } from "./v12-schema";
import { activeRule, baseV12Rule, aggregateDiagnosticLevel } from "./v12-engine";
import { coachingDecisionBasisSchema, coachingProfileSchema, type CoachingDecision, type CoachingDecisionBasis, type CoachingKind, type CoachingProfile } from "./coaching-schema";
import { executableRoutingRules, targetVerificationRules } from "./coaching-rules";
import { supportedGapRouting } from "./coaching-confidence";
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
  decisionBasis: CoachingDecisionBasis;
}

export function diagnoseCoaching(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, learnerLevel: string): CoachingProfile {
  const policy = manifest.v12!.coachingPolicy!;
  const state = runtime.v12!;
  const context = state.lastAssessmentContext;
  const currentContext = context && context.targetId === runtime.currentTargetId && context.questionId === runtime.currentQuestionId && context.stage === state.pedagogicalStage;
  const messageId = currentContext ? state.lastAssessmentMessageId : null;
  const assessment = messageId ? state.assessments[messageId] : undefined;
  const observed = [...new Set(assessment?.evidence.map((e) => e.evidenceId) ?? [])];
  const rule = runtime.currentTargetId ? activeRule(manifest, runtime) : null;
  const missing = rule ? [...rule.requiredAll.filter((id) => !observed.includes(id)), ...(!rule.requiredAny.some((id) => observed.includes(id)) ? rule.requiredAny : [])] : [];
  const prohibited = Boolean(rule?.prohibited.some((id) => observed.includes(id)));
  const verification = assessment && state.lastResult !== "NEED_VERIFY" && !prohibited && !missing.length && state.unitStates[runtime.currentTargetId!]?.status !== "MASTERED"
    ? targetVerificationRules(policy, runtime.currentTargetId) : [];
  missing.push(...verification.flatMap((item) => item.requiredAll.filter((id) => !observed.includes(id))));
  const supportedGap = assessment && messageId && !prohibited ? supportedGapRouting(manifest, runtime, assessment, missing, messageId) : undefined;
  const signals = {
    INITIAL: !assessment, UNRELIABLE: Boolean(assessment && state.lastResult === "NEED_VERIFY" && !supportedGap),
    MISCONCEPTION: Boolean(assessment && prohibited), MISSING: Boolean(assessment && missing.length),
    VERIFY: Boolean(assessment && !prohibited && !missing.length),
  };
  const matched = executableRoutingRules(policy).filter((item) => signals[item.signal]);
  const selected = matched[0];
  if (!selected) throw new Error("No matching knowledge coaching rule");
  const dimension = selected.execution.dimensionSelection === "MISSING_FIRST"
    ? policy.dimensionPriority.find((d) => (supportedGap?.missingEvidenceIds ?? missing).some((id) => policy.dimensions[d].evidenceIds.includes(id))) ?? selected.execution.dimension
    : selected.execution.dimension;
  const reason = [selected.description, `追问维度：${policy.dimensions[dimension].label}。`,
    ...(supportedGap ? [`依据${supportedGap.ruleId}，本题缺项判断置信度${supportedGap.confidence}达到${policy.minimumConfidence}，可以定向追问；掌握置信度仍为${assessment!.modelAssessmentConfidence}，不确认掌握、不改变评分或阶段门禁。`] : []),
    ...(assessment && missing.length ? [`当前核验范围尚缺：${[...new Set(missing)].slice(0, 8).map((id) => manifest.v12!.evidenceDefinitions[id]).join("；")}。`] : []),
  ].join("\n");
  return coachingProfileSchema.parse({ targetId: runtime.currentTargetId, level: assessment || state.diagnosticLevel ? aggregateDiagnosticLevel(state) : learnerLevel === "进阶" ? "L3" : learnerLevel === "有基础" ? "L2" : "L1", dimension, reasonId: selected.id, observedEvidenceIds: observed, missingEvidenceIds: [...new Set(missing)], basisMessageId: messageId, verifiedLevel: Boolean(state.diagnosticLevel),
    ruleDecision: { signal: selected.signal, questionId: assessment ? runtime.currentQuestionId : null, stage: assessment ? state.pedagogicalStage : null, matchedRoutingRuleIds: matched.map((item) => item.id), verificationRuleIds: verification.map((item) => item.id), reason, supportedGap },
  });
}

export function prepareCoaching(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, options: CoachingOptions): PreparedCoaching {
  const policy = manifest.v12?.coachingPolicy;
  if (!policy || !runtime.v12) throw new Error("Coaching requires a versioned knowledge policy");
  const diagnosed = options.profile ?? diagnoseCoaching(manifest, runtime, options.learnerLevel);
  let profile = diagnosed;
  const sameTarget = profile.targetId === runtime.currentTargetId;
  const initialRule = policy.routingRules.find((item) => item.signal === "INITIAL")!;
  if (!sameTarget) profile = { ...profile, targetId: runtime.currentTargetId, reasonId: initialRule.id, missingEvidenceIds: [], ruleDecision: undefined };
  const target = manifest.knowledgeUnits.find((u) => u.id === runtime.currentTargetId)?.title
    ?? manifest.v12!.competencies.find((u) => u.id === runtime.currentTargetId)?.description ?? manifest.knowledgePoint.title;
  const rule = runtime.currentTargetId ? baseV12Rule(manifest, runtime) : null;
  let choices: PreparedCoaching["choices"] = policy.stageFrames[options.kind].map((frame) => ({ ...frame, rule, framed: true }));
  const selectedSignal = policy.routingRules.find((item) => item.id === profile.reasonId)?.signal;
  if (!selectedSignal) throw new Error("Unknown coaching profile rule");
  const verification = runtime.v12.unitStates[runtime.currentTargetId!]?.status !== "MASTERED" ? targetVerificationRules(policy, runtime.currentTargetId) : [];
  const verificationIds = [...new Set(verification.flatMap((item) => item.requiredAll))];
  if (["DIAGNOSIS", "QUESTION"].includes(options.kind) && sameTarget && selectedSignal !== "INITIAL" && rule && !runtime.v12.currentCaseId && !runtime.currentQuestionId?.startsWith("CASE_VERIFY_")) {
    const focusedIds = profile.missingEvidenceIds.filter((id) => policy.dimensions[profile.dimension].evidenceIds.includes(id));
    const needsIntegratedVerification = selectedSignal === "VERIFY" && verificationIds.length > 0;
    const scopedRule: EvidenceRule = focusedIds.length ? {
      requiredAll: focusedIds.filter((id) => rule.requiredAll.includes(id) || verificationIds.includes(id)),
      requiredAny: focusedIds.filter((id) => rule.requiredAny.includes(id)), prohibited: rule.prohibited,
    } : needsIntegratedVerification ? { ...rule, requiredAll: [...new Set([...rule.requiredAll, ...verificationIds])] } : rule;
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
  const matchedRuleIds = [...new Set([...(diagnosed.ruleDecision?.matchedRoutingRuleIds ?? [diagnosed.reasonId]), ...(diagnosed.ruleDecision?.verificationRuleIds ?? []), ...(diagnosed.ruleDecision?.supportedGap ? [diagnosed.ruleDecision.supportedGap.ruleId] : []), ...(!sameTarget ? [initialRule.id] : [])])];
  const assessed = diagnosed.basisMessageId ? runtime.v12.assessments[diagnosed.basisMessageId] : undefined;
  const decisionBasis = coachingDecisionBasisSchema.parse({
    policyVersion: policy.version, releaseId: runtime.versions.releaseId, contentHash: runtime.versions.contentHash,
    assessedTargetId: diagnosed.basisMessageId ? diagnosed.targetId : null, assessedQuestionId: diagnosed.ruleDecision?.questionId ?? null, assessedStage: diagnosed.ruleDecision?.stage ?? null, basisMessageId: diagnosed.basisMessageId,
    selectedTargetId: runtime.currentTargetId, matchedRuleIds, selectedRuleId: profile.reasonId,
    reason: [diagnosed.ruleDecision?.reason ?? policy.routingRules.find((item) => item.id === diagnosed.reasonId)!.description,
      ...(assessed ? [`本轮候选判断最低置信度：${assessed.modelAssessmentConfidence}；知识库门槛：${policy.minimumConfidence}；服务端判定：${runtime.v12.lastResult}。`] : []),
      ...(!sameTarget ? ["题图已切换至新的追问目标，保留旧目标的诊断依据；新目标使用初始题，旧证据不作为新目标已掌握的依据。"] : []),
      ...(choices.every((choice) => choice.framed) ? [`${options.kind}使用锁定任务框架，不动态改写知识目标或案例事实。`] : []),
    ].join("\n"),
    assessment: assessed ? {
      result: runtime.v12.lastResult, confidence: assessed.modelAssessmentConfidence, minimumConfidence: policy.minimumConfidence,
      supportedGap: diagnosed.ruleDecision?.supportedGap,
      contradictions: assessed.contradictions, flags: runtime.flags,
      candidates: [
        ...assessed.candidateMastery.map((item) => ({ kind: "MASTERY", id: item.unitId, confidence: item.modelConfidence })),
        ...assessed.candidateMisconceptions.map((item) => ({ kind: "MISCONCEPTION", id: item.id, confidence: item.modelConfidence })),
        ...assessed.candidateGaps.map((item) => ({ kind: "GAP", id: item.id, confidence: item.modelConfidence })),
      ],
    } : null,
    evidence: runtime.v12.observations.filter((item) => item.ref.messageId === diagnosed.basisMessageId && diagnosed.observedEvidenceIds.includes(item.evidenceId)).map((item) => ({ evidenceId: item.evidenceId, ...item.ref })),
    questionRequirements: null,
  });
  return { input, choices, content: options.content, dimensionLabel: policy.dimensions[profile.dimension].label, decisionBasis };
}

export function recordCoaching(runtime: KnowledgeRuntime, prepared: PreparedCoaching, decision: CoachingDecision, meta: { requestId: string; now: string }, content = prepared.content) {
  const valid = createTeachingDecisionSchema(prepared.input).parse(decision);
  const choice = prepared.choices.find((c) => c.id === valid.choiceId)!;
  const opening = prepared.input.openings.find((o) => o.id === valid.openingId)!.text;
  const question = valid.followUp?.question ?? (choice.framed ? choice.template.replace("{content}", () => content) : choice.template);
  const next = structuredClone(runtime);
  const decisionBasis = coachingDecisionBasisSchema.parse({ ...prepared.decisionBasis, selectedTargetId: runtime.currentTargetId, questionRequirements: choice.rule });
  next.v12!.coachingHistory.push({ kind: prepared.input.kind, profile: prepared.input.profile, ...valid, decisionBasis, questionId: runtime.currentQuestionId, caseId: runtime.v12!.currentCaseId, provider: runtime.versions.modelProvider, model: runtime.versions.modelName, requestId: meta.requestId, createdAt: meta.now });
  if (["DIAGNOSIS", "QUESTION", "CASE", "FEYNMAN", "REFLECTION", "RESUME"].includes(prepared.input.kind) && choice.rule && (prepared.input.kind !== "RESUME" || runtime.v12!.resumeVerification)) {
    next.v12!.coachingPrompt = { questionId: runtime.currentQuestionId, stage: runtime.v12!.pedagogicalStage, text: question, rule: choice.rule };
  }
  const focus = ["DIAGNOSIS", "QUESTION"].includes(prepared.input.kind) && prepared.choices.some((item) => !item.framed) ? `追问焦点：${prepared.dimensionLabel}` : "";
  return { runtime: next, assistantMessage: valid.followUp ? question : [opening, focus, question].filter(Boolean).join("\n\n"), questionType: choice.questionType };
}
