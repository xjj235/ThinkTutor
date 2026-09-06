import type { TurnAssessmentInput } from "./types";
import { normalizeModelAssessment, type TurnAssessment } from "../knowledge/v12-schema";

// Development fixtures only. This deliberately conservative matcher is not a production classifier.
const patterns: Record<string, RegExp> = {
  shared_asset_loss: /共同(持仓|暴露).{0,30}(同时受损|损失)/u,
  deleveraging_or_concentrated_sale: /(共同(持仓|暴露)|同时受损).{0,45}(被迫抛售|集中出售|去杠杆)/u,
  transition_to_fire_sale: /(共同(持仓|暴露)|同时受损).{0,80}(被迫抛售|集中出售).{0,30}价格下跌.{0,30}(反馈|进一步损失)/u,
  financial_system_scope: /金融体系|金融系统/u, functional_impairment: /金融功能.{0,8}(受损|中断)|信贷.{0,4}收缩|支付.{0,6}(受阻|中断)/u,
  propagation: /传播|传染|传递|扩散/u, broad_propagation: /多个.{0,8}(机构|主体).{0,8}(损失|受损)|广泛传播/u,
  single_event_not_sufficient: /单[家体].{0,12}(不等于|不足|不一定)|不能.{0,8}(亏损|倒闭).{0,6}判断/u,
  systemic_scope: /Systemic.{0,12}(体系|功能)/iu, systematic_market_factor: /Systematic.{0,15}(市场|分散)/iu,
  research_object_distinction: /(区别|不同|区分).{0,20}(风险|对象)|Systemic.{0,60}Systematic/iu,
  no_direct_link_required: /(没有|无需|无).{0,6}(直接|借贷).{0,12}(仍|也|可以)/u,
  shared_asset_exposure: /共同持仓|共同暴露|持有同类资产|同一类资产/u, common_shock_can_harm_both: /同时.{0,8}(损失|受损|承压)/u,
  concentrated_or_forced_sale: /被迫.{0,4}(卖|出售|抛售)|集中.{0,4}(卖|抛售)|同步卖出/u,
  price_decline: /价格.{0,6}(下跌|下降)|压低.{0,4}价格/u, further_loss: /进一步损失|更多损失|扩大.{0,4}损失/u, price_feedback: /反馈|进一步损失/u,
  direct_exposure: /债权债务|直接敞口/u, loss_transmission: /违约.{0,12}(损失|传递)/u,
  withdrawal_funding_pressure: /集中提款|融资收缩/u, liquidity_need: /现金需求|现金缺口|流动性需求/u, forced_sale_or_service_pressure: /被迫出售长期资产|金融服务压力/u,
  information_confidence_shift: /负面信息|信心变化|预期变化/u, behavioral_response: /提款|拒绝续贷/u, cross_institution_spread: /其他银行.{0,10}(提款|影响)|跨机构扩散/u,
  confidence_channel: /信心.{0,8}(传播|传染|变化)/u, credit_tightening: /信贷收缩|收紧信贷|融资约束/u,
  investment_employment_effect: /(投资|就业|生产).{0,6}(下降|受损|减少)/u,
  size_not_unique: /规模不是唯一|不能只看规模/u, interconnectedness: /关联性|关联程度/u, substitutability: /可替代性|难以替代/u, complexity: /复杂性/u, key_function: /关键金融功能|关键服务/u,
  individual_action: /个体自保|单家机构.{0,6}(自保|减仓)/u, synchronization: /同步行动|同步卖出/u, system_feedback: /系统反馈|整体风险.{0,4}(上升|增加)/u,
  infrastructure_disruption: /支付清算.{0,6}(故障|中断)/u, risk_accumulation: /杠杆.{0,6}(累积|上升)|风险累积/u, cross_section: /横截面|同一时点/u,
  shock: /初始冲击|房价下跌|资产价格下跌|运营故障/u, amplification: /反馈|放大|连锁/u, system_consequence: /金融功能受损|金融服务中断|支付中断|金融功能未受损/u,
  condition_revision: /如果.{0,70}(则|那么|就|不会)/u, mechanism_example: /例如|举例|比如/u, clear_expression: /因为.{0,100}所以|首先.{0,200}最后/u,
  event_equals_systemic: /^一家银行倒闭就是系统性风险[。！!]?$/u, systemic_equals_systematic: /^Systemic和Systematic是同一个概念[。！!]?$/iu,
  direct_link_only: /^只有直接借贷才会传播风险[。！!]?$/u, size_only: /^只看规模就能判断系统重要性[。！!]?$/u, micro_safe_equals_system_safe: /^每家都安全系统就一定安全[。！!]?$/u,
};
export function mockAssessLearningTurn(input: TurnAssessmentInput): TurnAssessment {
  const evidence = Object.entries(patterns).filter(([id, pattern]) => input.evidenceDefinitions[id] && pattern.test(input.message.content)).map(([evidenceId]) => ({ evidenceId, messageId: input.message.id, extractedText: input.message.content }));
  return normalizeModelAssessment({ evidence, candidateMisconceptions: [], candidateGaps: [], candidateMastery: input.lockedContext.targetId ? [{ unitId: input.lockedContext.targetId, modelConfidence: evidence.length ? 0.9 : 0.3 }] : [], contradictions: [], recommendTransition: false });
}
