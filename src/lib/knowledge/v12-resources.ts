import legacy from "../../../knowledge/courses/financial-risk-management/systemic-risk/manifest.json" with { type: "json" };
import { knowledgeManifestSchema, type KnowledgeManifest } from "./schemas";
import { type EvidenceRule, type V12Resources } from "./v12-schema";
import { buildPedagogyRules } from "./pedagogy";
import coachingPolicy from "../../../knowledge/courses/financial-risk-management/systemic-risk/coaching-policy.json" with { type: "json" };
import { coachingPolicySchema } from "./coaching-schema";

const rule = (requiredAll: string[], requiredAny: string[] = [], prohibited: string[] = []): EvidenceRule => ({ requiredAll, requiredAny, prohibited });
export const legacySignalMap: Record<string, string[]> = {
  ERR_E04_COMMON_EXPOSURE_FIRE_SALE_MISSING: ["GAP_COMMON_EXPOSURE", "GAP_FIRE_SALE"],
  ERR_E04A_COMMON_EXPOSURE_MISSING: ["GAP_COMMON_EXPOSURE"],
  ERR_E04B_FIRE_SALE_FEEDBACK_MISSING: ["GAP_FIRE_SALE"],
  GAP_FIRE_SALE_FEEDBACK: ["GAP_FIRE_SALE"],
  ERR_E05_SIZE_ONLY: ["ERR_E05_SIZE_ONLY_SYSTEMIC_IMPORTANCE"],
  ERR_E07_DEFINITION_ONLY: ["GAP_DEFINITION_ONLY"],
  ERR_EXPRESSION_AMBIGUITY: ["FLAG_EXPRESSION_AMBIGUITY"],
};

const definitions: Record<string, string> = {
  shared_asset_loss: "共同资产敞口受到冲击并造成持有人损失", deleveraging_or_concentrated_sale: "共同资产损失引发去杠杆或集中出售", transition_to_fire_sale: "解释共同资产损失如何经集中出售转化为火售价格反馈",
  financial_system_scope: "明确研究金融体系而非单个机构", functional_impairment: "解释支付、信贷或金融服务功能受损", propagation: "解释冲击如何向其他主体传播", broad_propagation: "解释冲击向多个金融主体广泛传播", broad_external_effect: "指出单体以外的广泛外部影响",
  single_event_not_sufficient: "说明单体损失或倒闭不足以判定系统性风险", systemic_scope: "Systemic 指金融体系功能", systematic_market_factor: "Systematic 指不可分散的共同市场因子", research_object_distinction: "明确区分 Systemic、Systematic 和个体风险的研究对象",
  no_direct_link_required: "说明没有直接借贷也能传播", shared_asset_exposure: "指出持有同类资产导致共同暴露", common_shock_can_harm_both: "解释共同冲击同时损害多个持有者", price_feedback: "解释卖出降价再扩大损失的反馈", confidence_channel: "说明信心变化跨机构传播",
  size_not_unique: "明确规模不是唯一因素", interconnectedness: "解释关联程度", substitutability: "解释关键服务可替代性", complexity: "解释结构复杂性", key_function: "解释承担的关键金融功能",
  direct_exposure: "指出直接债权债务敞口", loss_transmission: "解释违约损失如何沿直接敞口传递", concentrated_or_forced_sale: "说明被迫或同步抛售", price_decline: "解释抛售压低市场价格", further_loss: "解释价格下跌造成其他持有人进一步损失",
  withdrawal_funding_pressure: "指出集中提款或融资收缩", liquidity_need: "解释即时现金需求与资产期限差异", forced_sale_or_service_pressure: "解释现金缺口导致被迫处置资产或服务压力",
  information_confidence_shift: "指出负面信息引起预期变化", behavioral_response: "说明提款、拒绝续贷等行为反应", cross_institution_spread: "解释预期和行为扩散到其他机构",
  credit_tightening: "解释金融机构收紧信贷或融资约束", investment_employment_effect: "解释企业投资、生产或就业受影响", individual_action: "说明单个机构自保行为", synchronization: "说明多个机构同步行动", system_feedback: "解释同步行动的系统反馈",
  infrastructure_disruption: "解释支付清算故障跨机构中断金融服务", risk_accumulation: "解释繁荣期杠杆与风险累积", cross_section: "解释同一时点机构之间的风险分布",
  shock: "指出本案例具体初始冲击", amplification: "解释本案例放大或反馈环节（反例可说明其不存在）", system_consequence: "解释本案例金融体系功能后果或其未受损的证据", condition_revision: "给出一个条件变化并据此修正判断", mechanism_example: "自主举出例子并解释机制", clear_expression: "用自己的话作出可理解、有层次的解释",
  event_equals_systemic: "明确声称单家机构倒闭本身必然就是系统性风险", systemic_equals_systematic: "明确将 Systemic 与 Systematic 等同", direct_link_only: "明确声称仅直接借贷能传播", size_only: "明确声称规模是唯一系统重要性依据", micro_safe_equals_system_safe: "明确声称个体安全必然保证系统安全", sale_always_reduces_risk: "明确声称卖出必然降低系统风险而否认反馈", liquidity_equals_insolvency: "明确将暂时现金压力等同最终资不抵债", financial_only: "明确否认实体经济反馈",
};
const unitRules: Record<string, EvidenceRule> = {
  C_SR_001: rule(["financial_system_scope"], ["functional_impairment", "broad_propagation"], ["event_equals_systemic", "systemic_equals_systematic"]),
  C_SR_002: rule(["research_object_distinction", "systemic_scope", "systematic_market_factor"], [], ["systemic_equals_systematic"]),
  M_SR_001: rule(["direct_exposure", "loss_transmission"]),
  M_SR_002: rule(["no_direct_link_required", "shared_asset_exposure", "common_shock_can_harm_both"], [], ["direct_link_only"]),
  M_SR_003: rule(["concentrated_or_forced_sale", "price_decline", "further_loss"], [], ["sale_always_reduces_risk"]),
  M_SR_004: rule(["withdrawal_funding_pressure", "liquidity_need", "forced_sale_or_service_pressure"], [], ["liquidity_equals_insolvency"]),
  M_SR_005: rule(["information_confidence_shift", "behavioral_response", "cross_institution_spread"], [], ["direct_link_only"]),
  M_SR_006: rule(["infrastructure_disruption", "functional_impairment"]),
  M_SR_007: rule(["credit_tightening", "investment_employment_effect"], [], ["financial_only"]),
  D_SR_001: rule(["cross_section"]), D_SR_002: rule(["risk_accumulation"]),
  C_SR_003: rule(["size_not_unique"], ["interconnectedness", "substitutability", "complexity", "key_function"], ["size_only"]),
  C_SR_004: rule(["individual_action", "synchronization", "system_feedback"], [], ["micro_safe_equals_system_safe"]),
  COMP_SR_TRANSFER: rule(["shock", "propagation", "amplification", "system_consequence", "condition_revision"]),
  COMP_SR_CAUSAL_CHAIN: rule(["shock", "propagation", "amplification", "system_consequence"]),
  COMP_SR_MECHANISM_INTEGRATION: rule(["withdrawal_funding_pressure", "information_confidence_shift", "cross_institution_spread"]),
};
const groupTargets: Record<string, string> = { SQG_SR_001: "C_SR_001", SQG_SR_002: "C_SR_002", SQG_SR_003: "M_SR_001", SQG_SR_004: "M_SR_002", SQG_SR_005: "M_SR_003", SQG_SR_006A: "M_SR_004", SQG_SR_006B: "M_SR_005", SQG_SR_007: "M_SR_007", SQG_SR_008: "C_SR_003", SQG_SR_009: "C_SR_004", SQG_SR_010: "COMP_SR_TRANSFER" };
const gapTargets: Record<string, string> = { GAP_COMMON_EXPOSURE: "M_SR_002", GAP_FIRE_SALE: "M_SR_003", GAP_DEFINITION_ONLY: "COMP_SR_CAUSAL_CHAIN", GAP_TRANSFER: "COMP_SR_TRANSFER", GAP_CAUSAL_CHAIN: "COMP_SR_CAUSAL_CHAIN", GAP_CONDITION_MISSING: "C_SR_001", GAP_LIQUIDITY_MECHANISM: "M_SR_004", GAP_CONFIDENCE_CONTAGION: "M_SR_005" };
const errors: V12Resources["errors"] = Object.fromEntries([
  ["ERR_E01_SYSTEMIC_SYSTEMATIC_CONFUSION", "systemic_equals_systematic", "C_SR_002"],
  ["ERR_E02_EVENT_EQUALS_SYSTEMIC", "event_equals_systemic", "C_SR_001"],
  ["ERR_E03_DIRECT_LINK_ONLY", "direct_link_only", "M_SR_002"],
  ["ERR_E05_SIZE_ONLY_SYSTEMIC_IMPORTANCE", "size_only", "C_SR_003"],
  ["ERR_E06_MICRO_SAFE_EQUALS_SYSTEM_SAFE", "micro_safe_equals_system_safe", "C_SR_004"],
].map(([id, evidenceId, targetId]) => [id, { evidenceId, targetId, resolutionRule: unitRules[targetId] }]));

export function buildV12Manifest(): KnowledgeManifest {
  const m = knowledgeManifestSchema.parse(structuredClone(legacy));
  m.release = { id: "KR_SR_1_2", status: "draft", verifiedBy: null, verifiedAt: null, publishNote: "v1.2.1 normalized specification; teacher review required." };
  for (const resource of [m.course, m.chapter, m.knowledgePoint, m.rubric, ...m.knowledgeUnits]) resource.version = "1.2";
  m.misconceptions = m.misconceptions.flatMap((e) => {
    const id = legacySignalMap[e.id]?.[0] ?? e.id;
    return errors[id] ? [{ ...e, id }] : [];
  });
  const validErrors = new Set(m.misconceptions.map((e) => e.id));
  const normalizeErrors = (list: string[]) => list.flatMap((id) => legacySignalMap[id] ?? [id]).filter((id) => validErrors.has(id));
  m.knowledgeUnits.forEach((u) => { u.misconceptions = normalizeErrors(u.misconceptions); });
  m.socraticQuestions = m.socraticQuestions.filter((q) => !q.id.startsWith("SQ_SR_006_"));
  m.hints = m.hints.filter((h) => !h.questionId.startsWith("SQ_SR_006_"));
  const prompts = {
    "006A": ["储户集中提款带来的现金压力如何影响银行的资产处置？", "融资来源突然收缩时，银行为什么可能被迫出售长期资产？", "你能从流动性需求、资产处置到后续压力解释这一机制吗？"],
    "006B": ["一家银行的负面信息为什么可能改变其他银行储户的行为？", "如果其他银行没有直接损失，信心变化仍可能怎样形成跨机构影响？", "你能从信息预期、行为反应到跨机构扩散解释信心传染吗？"],
  };
  for (const [suffix, questions] of Object.entries(prompts)) questions.forEach((questionText, i) => {
    const id = `SQ_SR_${suffix}_${"ABC"[i]}`;
    m.socraticQuestions.push({ id, targetUnitId: groupTargets[`SQG_SR_${suffix}`], questionType: "CAUSE_PROBE", questionText, difficulty: i + 1, prerequisites: ["C_SR_001"], triggerErrorTags: [], triggerErrorCategories: [], status: "published" });
    for (const level of [1, 2]) m.hints.push({ id: `HINT_${id}_${level}`, questionId: id, level, hintText: level === 1 ? "先找出情境中的参与者和他们行为改变的原因，你能连接其中两个环节吗？" : "把原因、行为和后果分开，再检查前一步如何引出后一步，你会怎样连接这条链？" });
  });
  m.socraticQuestions.forEach((q) => {
    q.triggerErrorTags = normalizeErrors(q.triggerErrorTags);
    q.triggerErrorCategories = q.triggerErrorCategories.filter((c) => m.misconceptions.some((e) => e.category === c));
    if (q.id.startsWith("SQ_SR_010_")) q.targetUnitId = "COMP_SR_TRANSFER";
  });
  m.questionGroups = Object.entries(groupTargets).map(([id, targetId]) => ({ id, targetId, memberIds: m.socraticQuestions.filter((q) => q.id.startsWith(id.replace("SQG_", "SQ_") + "_")).map((q) => q.id), selectionPolicy: "UNUSED_FIRST" }));
  m.questionEdges = m.questionEdges.filter((e) => m.socraticQuestions.some((q) => q.id === e.fromQuestionId) && m.socraticQuestions.some((q) => q.id === e.toQuestionId));
  const variants = ["COMMON_EXPOSURE", "SYSTEMIC_BOUNDARY", "LIQUIDITY_CONFIDENCE", "FINANCIAL_CYCLE", "COMMON_EXPOSURE", "INFRASTRUCTURE", "MICRO_MACRO", "SYSTEMIC_IMPORTANCE"];
  const critical = [["M_SR_002", "REL_SR_003", "M_SR_003", "M_SR_007"], ["C_SR_001", "COMP_SR_TRANSFER"], ["M_SR_004", "M_SR_003", "M_SR_005"], ["D_SR_002", "M_SR_002", "M_SR_003", "M_SR_007", "COMP_SR_CAUSAL_CHAIN"], ["M_SR_002", "REL_SR_003", "M_SR_003", "C_SR_001"], ["M_SR_006", "C_SR_001", "COMP_SR_TRANSFER"], ["C_SR_004", "M_SR_003"], ["C_SR_003"]];
  const caseConfigs: V12Resources["cases"] = {};
  m.cases.forEach((c, i) => {
    c.caseType = (["basic", "counterexample", "basic", "comprehensive", "transfer", "transfer", "counterexample", "transfer"] as const)[i];
    c.variantGroupId = `CASEG_${variants[i]}`;
    c.teacherData.commonErrors = normalizeErrors(c.teacherData.commonErrors);
    c.teacherData.followUpGroupIds = c.teacherData.followUpGroupIds.flatMap((id) => id === "SQG_SR_006" ? ["SQG_SR_006A", "SQG_SR_006B"] : [id]);
    const followUp = Object.fromEntries(critical[i].map((step) => [step, Object.keys(groupTargets).find((g) => groupTargets[g] === step) ?? (step === "REL_SR_003" ? "SQG_SR_005" : "SQG_SR_010")]));
    caseConfigs[c.id] = { synthetic: true, studentQuestions: "请依据情境说明冲击如何发展及其后果，并选择一个条件变化说明你的判断会如何改变？", criticalSteps: critical[i], followUp, rule: unitRules.COMP_SR_TRANSFER };
  });
  m.v12 = {
    coachingPolicy: coachingPolicySchema.parse(coachingPolicy),
    specVersion: "1.2.1",
    pedagogyRules: buildPedagogyRules(),
    sourceDocumentHashes: Object.fromEntries([
      "6591a4776bedac7ce2e4f9a214b3604304f3b559737499251d12c3db9f84fa75", "0780ea3968df8e2a23045f09f0b87187f6d0f03ddf652c174ef83a9d689402bb", "c1d439af9bfcf760945e707b5d048413e438af50daaf137c445412b453c8236f", "953f2a37a0b6eeb5da8f1d8fa0ef18b41e28418b56d74c55f7bfeca49d092881", "20086ffb3f4d25b1da928d42f42020ca6403a103d2aa3ca801c925e63a41bcb6", "08b7443e3a367972e87f31c04adb9ae47ae92059d0428861b74903b8ec7900ee", "146db9c00927322926b6de33a6da5b3d5c29f3b4c559937c48da42a42e2ce277", "a039dbcfdfbbc4ec79eccdbdd9ddf2275ed0dfcf9e3723a7f3af4100e6825123",
    ].map((hash, i) => [`DOC_SR_0${i + 1}`, hash])),
    evidenceDefinitions: definitions,
    relations: [
      ["C_SR_001", "requires", "C_SR_002"], ["M_SR_002", "contrasts_with", "M_SR_001"], ["M_SR_002", "causes", "M_SR_003"], ["M_SR_003", "amplifies", "M_SR_002"], ["M_SR_004", "related_to", "M_SR_005"], ["M_SR_003", "causes", "M_SR_007"], ["D_SR_001", "related_to", "C_SR_003"], ["D_SR_002", "related_to", "C_SR_004"],
    ].map(([source, relation, target], i) => ({ id: `REL_SR_00${i + 1}`, source, relation, target, scope: i === 0 ? "mastery_dependency" : "conceptual_relation" })),
    competencies: [{ id: "COMP_SR_TRANSFER", description: "未见情境与条件变化迁移" }, { id: "COMP_SR_CAUSAL_CHAIN", description: "冲击、传播、放大、后果因果链" }, { id: "COMP_SR_MECHANISM_INTEGRATION", description: "流动性与信心机制综合验证" }],
    aliases: { C_SR_001: { accepted: ["金融体系层面的风险", "金融功能大范围受损"], forbidden: ["单家机构亏损或倒闭本身就是系统性风险"] }, M_SR_002: { accepted: ["共同持仓", "共同资产暴露"], forbidden: ["只有直接借贷才会传播"] }, M_SR_003: { accepted: ["折价抛售", "资产价格反馈"], forbidden: ["卖出行为必然降低系统风险"] }, C_SR_003: { accepted: ["系统重要机构", "关键金融功能"], forbidden: ["规模是唯一标准"] } },
    unitRules,
    relationRules: { REL_SR_003: rule(["shared_asset_loss", "deleveraging_or_concentrated_sale", "transition_to_fire_sale"], [], ["sale_always_reduces_risk", "direct_link_only"]) },
    unitSourceRefs: Object.fromEntries(m.knowledgeUnits.map((u) => [u.id, { contentSourceRefs: ["DOC_SR_01", "DOC_SR_06"], teachingSourceRefs: ["DOC_SR_02", "DOC_SR_03", "DOC_SR_05"], assessmentSourceRefs: ["DOC_SR_04", "DOC_SR_07", "DOC_SR_08"] }])),
    diagnosticRules: {
      DQG_SR_001: rule(["financial_system_scope"], ["propagation", "functional_impairment"], ["event_equals_systemic", "systemic_equals_systematic"]),
      DQG_SR_002: rule(["single_event_not_sufficient"], ["propagation", "functional_impairment", "broad_external_effect"], ["event_equals_systemic"]),
      DQG_SR_003: unitRules.C_SR_002,
      DQG_SR_004: rule(["no_direct_link_required"], ["shared_asset_exposure", "price_feedback", "confidence_channel"], ["direct_link_only"]),
      DQG_SR_005: unitRules.C_SR_003,
    },
    groups: Object.fromEntries(Object.entries(groupTargets).map(([id, primaryTargetId]) => [id, { primaryTargetId, prerequisites: primaryTargetId === "COMP_SR_TRANSFER" ? ["C_SR_001", "C_SR_002"] : m.knowledgeUnits.find((u) => u.id === primaryTargetId)?.prerequisites ?? [], secondaryTargets: id === "SQG_SR_010" ? ["COMP_SR_CAUSAL_CHAIN"] : [], triggerErrors: Object.keys(errors).filter((e) => errors[e].targetId === primaryTargetId), triggerGaps: Object.keys(gapTargets).filter((g) => gapTargets[g] === primaryTargetId), triggerCategories: [...new Set(m.misconceptions.filter((e) => errors[e.id]?.targetId === primaryTargetId).map((e) => e.category))], triggerFlags: ["FLAG_NEED_VERIFY"], rule: unitRules[primaryTargetId] }])),
    errors, gaps: gapTargets,
    edges: [{ from: "SQG_SR_001", condition: "success", to: "SQG_SR_002" }, { from: "SQG_SR_002", condition: "success", to: "SQG_SR_004" }, { from: "SQG_SR_004", condition: "success", to: "SQG_SR_005" }, { from: "SQG_SR_006A", condition: "success", to: "SQG_SR_006B" }, { from: "ANY_GROUP", condition: "fail_twice", to: "HINT_LEVEL_1" }, { from: "ANY_GROUP", condition: "fail_after_hint_1", to: "HINT_LEVEL_2" }, { from: "ANY_GROUP", condition: "contradictory", to: "NEED_VERIFY" }],
    cases: caseConfigs,
  };
  for (const source of m.sources) {
    source.version = "1.2";
    source.checksum = m.v12.sourceDocumentHashes[source.id];
    source.location = source.location.replace("_修订版.docx", "_v1.2精修版.docx").replace("案例库设计", "案例设计");
    source.location = source.location.replace(".docx", source.id === "DOC_SR_07" ? " (1)(1).docx" : "(1).docx");
  }
  for (const unit of m.knowledgeUnits) {
    const refs = m.v12.unitSourceRefs[unit.id];
    unit.sourceRefs = [...new Set([...refs.contentSourceRefs, ...refs.teachingSourceRefs, ...refs.assessmentSourceRefs])].map((sourceId) => ({ sourceId, sourceLocator: `${unit.id} / 工程条款映射，页码待教师核验`, confidence: 0.5 }));
  }
  return knowledgeManifestSchema.parse(m);
}
