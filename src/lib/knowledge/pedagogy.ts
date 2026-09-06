import type { V12Resources, V12State } from "./v12-schema";

export function buildPedagogyRules(): V12Resources["pedagogyRules"] {
  const descriptions = ["单轮一个主目标", "基于当前回答选题", "启发而非代答", "保留已经建立的正确证据", "正确后提高验证要求", "禁止固定播放问题图谱", "稳定掌握后停止重复", "提供分层提示", "依据表现调节难度", "学生自主输出前置", "验证因果解释", "验证未见情境迁移", "反馈绑定真实证据", "核心错误优先", "重大漏洞回退", "错误或部分正确时启发", "两级提示升级", "矛盾证据触发核验"];
  return descriptions.map((description, i) => {
    const priority = [0, 9, 12, 13, 14, 17].includes(i) ? 300 : [1, 4, 6, 10, 11].includes(i) ? 200 : 100;
    const project = [0, 9, 11, 12, 13, 14, 16, 17].includes(i);
    return {
      id: `PED_${String(i + 1).padStart(3, "0")}`, description,
      scope: ["DIAGNOSIS", "KNOWLEDGE_CONSTRUCTION", "CASE_TRANSFER", "FEYNMAN_OUTPUT", "REFLECTION"],
      priority, priorityLabel: priority === 300 ? "critical" : priority === 200 ? "high" : "medium",
      basisType: project ? "project_custom" : "engineering_interpretation",
      trigger: { event: "TURN_ASSESSED" },
      precondition: { signal: i === 17 ? "UNRELIABLE" : [13, 14].includes(i) ? "MAJOR_ERROR" : [7, 16].includes(i) ? "NO_PROGRESS" : i === 6 ? "MASTERED" : "ALWAYS" },
      effect: { action: i === 17 ? "VERIFY" : [13, 14].includes(i) ? "PRIORITIZE_ERROR" : [7, 16].includes(i) ? "SCAFFOLD" : i === 6 ? "SKIP_MASTERED" : "SERVER_POLICY" },
      sourceType: project ? "project" : "engineering", sourceTitle: "系统性风险教学理论整理（工程映射，待教师核验）",
      sourceLocation: `DOC_SR_03 / PED_${String(i + 1).padStart(3, "0")}`,
      version: "1.2.1", status: "DRAFT", verifiedBy: null, verifiedAt: null,
    };
  });
}

export function applicablePedagogyRules(resources: V12Resources, state: V12State) {
  const matches = (signal: V12Resources["pedagogyRules"][number]["precondition"]["signal"]) => {
    if (signal === "UNRELIABLE") return state.lastResult === "NEED_VERIFY";
    if (signal === "MAJOR_ERROR") return Object.values(state.misconceptionStates).some((c) => ["CONFIRMED", "UNRESOLVED"].includes(c.status));
    if (signal === "NO_PROGRESS") return Object.values(state.noProgressCounts).some((n) => n >= 2);
    if (signal === "MASTERED") return Object.values(state.unitStates).some((u) => u.status === "MASTERED");
    return true;
  };
  return resources.pedagogyRules.filter((r) => r.scope.includes(state.pedagogicalStage) && matches(r.precondition.signal)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
