import { learningFeedbackSchema, type LearningFeedback } from "../learning-feedback";
import type { CoachingDecisionBasis, CoachingKind, CoachingProfile } from "./coaching-schema";
import type { KnowledgeRuntime } from "./runtime-schemas";
import type { KnowledgeManifest } from "./schemas";
import { targetVerificationRules } from "./coaching-rules";

// These name a reasoning task, never supply the missing causal link or conclusion.
const evidenceTopics: Record<string, string> = {
  financial_system_scope: "判断所针对的范围", systemic_scope: "Systemic 的研究对象", systematic_market_factor: "Systematic 的研究对象",
  research_object_distinction: "相近概念的区别", single_event_not_sufficient: "单一事件与整体判断的关系", no_direct_link_required: "传播途径的边界",
  size_not_unique: "判断系统重要性的依据", cross_section: "同一时点的风险分布",
  shared_asset_loss: "共同持仓受到冲击后的影响", shared_asset_exposure: "主体之间的共同暴露", common_shock_can_harm_both: "共同冲击下各主体的变化",
  deleveraging_or_concentrated_sale: "损失发生后的行为选择", transition_to_fire_sale: "两种传播机制之间的联系", price_feedback: "价格与损失之间的反馈",
  functional_impairment: "金融服务受到的具体影响", propagation: "影响传到其他主体的过程", broad_propagation: "影响范围扩大的过程", broad_external_effect: "单个主体之外的影响",
  confidence_channel: "信心变化的影响途径", interconnectedness: "机构之间的联系", complexity: "结构复杂性", key_function: "机构承担的关键功能", substitutability: "服务的可替代条件",
  direct_exposure: "主体之间的直接联系", loss_transmission: "损失从一个主体传到另一个主体的过程",
  concentrated_or_forced_sale: "资产处置的动机与时机", price_decline: "交易行为与价格变化的联系", further_loss: "价格变化对其他持有者的影响",
  withdrawal_funding_pressure: "资金来源的变化", liquidity_need: "资金需求与可用资金之间的时间关系", forced_sale_or_service_pressure: "资金压力下的行为与后果",
  information_confidence_shift: "信息与预期的联系", behavioral_response: "预期变化后的行为", cross_institution_spread: "行为影响跨越机构的过程",
  credit_tightening: "融资条件的变化", investment_employment_effect: "金融变化与实体活动的联系", individual_action: "个体的行为动机", synchronization: "多个主体行动的时间关系", system_feedback: "个体行动与整体结果的联系",
  infrastructure_disruption: "基础设施变化与金融服务的联系", risk_accumulation: "风险随时间的变化",
  shock: "情境中最初发生的变化", amplification: "影响扩大或受限的环节", system_consequence: "情境最终影响到的范围与功能",
  condition_revision: "条件变化后原判断是否需要修正", mechanism_example: "例子与推理之间的对应", clear_expression: "用自己的话串联判断与依据",
};

const dimensionReasons = {
  CONCEPT: "把判断对象和边界说清楚，才能分辨看似相近的现象，避免只凭名称作判断。",
  MECHANISM: "连接原因、参与者的反应和后果，才能解释事情为什么发生，并判断换个情境后是否还会发生。",
  CONDITION: "检验条件改变后的结论，能帮助你区分一个判断何时成立、何时需要调整，避免把它当成总是成立的规则。",
  EVIDENCE: "把具体依据和结论对应起来，才能分清是表达还不清楚，还是推理本身需要修改。",
  TRANSFER: "把已有解释用于新的情境，可以检验你是否能独立使用它，而不仅是记住原来的说法。",
} satisfies Record<CoachingProfile["dimension"], string>;

// Name the student's expressed rule and the decision it affects, without
// supplying the conclusion that the next question is meant to elicit.
const claimGuidance: Record<string, { observation: string; focus: string; reason: string }> = {
  event_equals_systemic: { observation: "你把一家机构倒闭直接当成了系统性风险的判据。", focus: "检验从单个机构事件推到整个系统判断的成立条件。", reason: "如果没有核对判断涉及的范围，就可能把不同层次的风险混在一起，影响对事件后果的判断。" },
  systemic_equals_systematic: { observation: "你把 Systemic 与 Systematic 当作了同一个概念。", focus: "对照这两个概念分别在回答什么问题，核验它们能否互换。", reason: "概念所指的对象会决定采用哪些证据；对象没有分清，后面的判断就可能用错依据。" },
  direct_link_only: { observation: "你把直接债权债务联系当作了风险传播的必要条件。", focus: "检验缺少这种直接联系时，你的判断是否仍然成立。", reason: "必要条件的判断决定你会关注哪些传播途径；如果范围定得过窄，就可能漏掉需要解释的联系。" },
  size_only: { observation: "你把规模当作了判断系统重要性的唯一依据。", focus: "检验只凭规模作判断的成立条件。", reason: "判断依据决定不同机构如何比较；检验这个依据能帮助说明为什么某家机构需要被重点关注。" },
  micro_safe_equals_system_safe: { observation: "你从单个主体的安全直接推到了整个系统的安全。", focus: "检验个体判断能否直接推广到多个主体共同组成的系统。", reason: "个体与整体对应的是不同层次的判断；说清两者的联系，才能解释同一种行为汇集后的结果。" },
  sale_always_reduces_risk: { observation: "你认为卖出资产一定会降低系统风险。", focus: "检验这个结论在不同出售条件下是否仍然成立。", reason: "如果没有检查行动发生的条件，就可能把某个情境中的结果当成始终有效的规则。" },
  liquidity_equals_insolvency: { observation: "你把暂时的现金压力与最终资不抵债等同起来了。", focus: "核对这两种判断各自依赖的信息和时间范围。", reason: "判断依据和时间范围会影响对问题性质的解释；先分清它们，后续推理才有一致的起点。" },
  financial_only: { observation: "你的判断把后果限定在了金融体系内部。", focus: "检验这一范围是否足以解释题目涉及的后续影响。", reason: "影响范围会决定需要追踪到哪一步；范围没有说明，原因到结果的解释就可能不完整。" },
};

export function buildCoachingFeedback(manifest: KnowledgeManifest, runtime: KnowledgeRuntime, input: {
  kind: CoachingKind;
  profile: CoachingProfile;
  basis: CoachingDecisionBasis;
  studentContent?: string;
  answerMessageId?: string;
}): LearningFeedback | undefined {
  const { profile, basis, kind, answerMessageId, studentContent } = input;
  // Hints and lifecycle events may retain an old diagnostic profile; only a new
  // answer can receive new feedback, and the binding must match that assessment.
  if (!answerMessageId || answerMessageId !== basis.basisMessageId || !studentContent?.trim() || !basis.assessment) return undefined;
  const policy = manifest.v12!.coachingPolicy!;
  const targetTitle = (id: string | null) => manifest.knowledgeUnits.find((unit) => unit.id === id)?.title
    ?? manifest.v12!.competencies.find((unit) => unit.id === id)?.description ?? manifest.knowledgePoint.title;
  const title = targetTitle(basis.assessedTargetId).slice(0, 60);
  const topic = (id: string) => evidenceTopics[id] ?? policy.dimensions[profile.dimension].label;
  const prohibited = new Set(Object.values(manifest.v12!.unitRules).flatMap((rule) => rule.prohibited));
  const references = basis.evidence.filter((ref) => ref.messageId === answerMessageId
    && studentContent.slice(ref.startOffset, ref.endOffset) === ref.extractedText);
  const negative = references.find((ref) => prohibited.has(ref.evidenceId));
  const positive = references.filter((ref) => !prohibited.has(ref.evidenceId));
  const assessment = basis.assessment;
  const uncertain = assessment.result === "NEED_VERIFY";
  const conflicting = assessment.contradictions.length > 0;

  // Find the presentation that actually elicited this answer. Evidence extracted
  // for other rubric dimensions, or another target's answer, cannot repair its gap.
  const previousTurn = runtime.v12!.coachingHistory.filter((entry) => entry.questionId === basis.assessedQuestionId
    && entry.decisionBasis?.selectedTargetId === basis.assessedTargetId
    && entry.decisionBasis.basisMessageId !== answerMessageId).at(-1);
  const previous = previousTurn?.decisionBasis?.assessedTargetId === basis.assessedTargetId
    && previousTurn.decisionBasis.basisMessageId ? previousTurn.decisionBasis : undefined;
  const targetRule = manifest.v12!.unitRules[basis.assessedTargetId ?? ""] ?? manifest.v12!.relationRules[basis.assessedTargetId ?? ""];
  const targetEvidence = new Set([
    ...(targetRule?.requiredAll ?? []), ...(targetRule?.requiredAny ?? []),
    ...targetVerificationRules(policy, basis.assessedTargetId).flatMap((rule) => rule.requiredAll),
  ]);
  const requestedEvidence = new Set([...(previous?.questionRequirements?.requiredAll ?? []), ...(previous?.questionRequirements?.requiredAny ?? [])]);
  const previousIds = new Set(previous?.evidence.map((ref) => ref.evidenceId));
  const addition = previous && !uncertain && !negative && !conflicting ? positive.find((ref) => targetEvidence.has(ref.evidenceId)
    && requestedEvidence.has(ref.evidenceId) && previousTurn!.profile.missingEvidenceIds.includes(ref.evidenceId) && !previousIds.has(ref.evidenceId)
    && runtime.v12!.observations.some((item) => item.ref.messageId === answerMessageId && item.evidenceId === ref.evidenceId && item.independent && item.confidence >= 0.75)) : undefined;
  const quote = (negative ?? addition ?? positive[0])?.extractedText ?? studentContent;
  const answerQuote = quote.trim().slice(0, 240).trim();
  const claim = negative && answerQuote.includes(negative.extractedText.trim()) ? claimGuidance[negative.evidenceId] : undefined;
  // A second reference elsewhere in the answer cannot be attributed to this
  // excerpt. Long references also cannot assert what a truncated excerpt proves.
  const observedTopics = [...new Set(positive.filter((ref) => answerQuote.includes(ref.extractedText.trim()))
    .map((ref) => topic(ref.evidenceId)))].slice(0, 2).join("、");
  let observation = observedTopics
    ? `你的这段回答已经涉及${observedTopics}。`
    : positive.length ? `这是你关于“${title}”的一段原文摘录；这部分的判断还需要结合完整回答中的依据。`
    : `你给出了对“${title}”的看法，目前还缺少能核实这段解释的具体依据。`;
  if (conflicting) observation = `这段回答中有需要相互核对的说法，目前还不能确认它们是否一致。我们先澄清依据。`;
  else if (uncertain) observation = assessment.supportedGap
    ? `你的回答已提到${observedTopics || title}，可以据此继续追问，但尚不足以确认整体掌握。`
    : `这段表述还需要独立核实；目前不能据此判断你已经掌握，也不能把没有说出的部分判为错误。`;
  else if (negative) observation = claim?.observation ?? `你在这段原文中作出了一个明确判断；这个判断的适用边界还需要检验。`;

  const missing = profile.missingEvidenceIds.filter((id) => policy.dimensions[profile.dimension].evidenceIds.includes(id));
  const focusTopics = [...new Set(missing.map(topic))].slice(0, 2).join("、") || policy.dimensions[profile.dimension].label;
  let focus = negative ? claim?.focus ?? `检验你这句判断在“${title}”中的成立条件。`
    : uncertain && !assessment.supportedGap ? `用一个具体依据澄清你对“${title}”的判断。`
    : missing.length ? `这次先补充“${title}”中的${focusTopics}。`
    : `把刚才关于“${title}”的解释用于一个新情境，并核实关键条件。`;
  let whyItMatters = !uncertain && !conflicting && claim ? claim.reason : dimensionReasons[profile.dimension];
  if (conflicting) {
    focus = `核对这段回答中不同说法各自依据的条件，说明它们能否同时成立。`;
    whyItMatters = "先澄清说法之间的关系，后面的推理才有一致的起点；这里暂不把任何一方当成正确答案。";
  } else if (kind === "FEYNMAN" || kind === "REFLECTION") {
    focus = kind === "FEYNMAN" ? "把刚才讨论的判断与依据连成一段自己的解释，标出仍不确定的一处。" : "回看刚才解释中最不确定的一处，补上理由后重新表述。";
    whyItMatters = `${runtime.v12!.experienceLimitReached ? "本次追问已到轮数上限，尚未核实的内容会保留；" : ""}独立解释能检验各个环节是否连得起来，进入这一步不表示所有内容都已掌握。`;
  } else if (kind === "REPORT") {
    focus = "对照这次解释中的依据与待核实内容，选择下一次要巩固的一处。";
    whyItMatters = "回看有原文依据的变化，可以分清已经补充的内容和仍需练习的部分，让下一次学习有明确起点。";
  } else if (kind === "CASE") {
    focus = "把刚才的解释用于接下来的情境，并指出哪些具体事实支持你的判断。";
    whyItMatters = "情境变化会检验同一套推理能否独立使用；前面问题的通过不能代替这次应用中的依据。";
  } else if (basis.assessedTargetId !== basis.selectedTargetId) {
    focus = `接下来转向“${targetTitle(basis.selectedTargetId).slice(0, 60)}”，请说明你的判断依据。`;
    whyItMatters = `刚才关于“${title}”的回答会保留${assessment.result === "PASS" ? "为本题的依据" : "，其中未核实的部分仍待补充"}。换一个角度能检查理解是否完整，不能用前一题的表现代替新问题的回答。`;
  }

  const priorQuote = previous?.evidence[0]?.extractedText.trim().slice(0, 50);
  const progress = addition ? `与此前${priorQuote ? `“${priorQuote}”的表述` : "这部分的回答"}相比，这次新增了${topic(addition.evidenceId)}的解释；这是本次观察到的补充，还需结合其他依据检验。` : null;
  return learningFeedbackSchema.parse({ answerQuote, observation, focus, whyItMatters, progress });
}
