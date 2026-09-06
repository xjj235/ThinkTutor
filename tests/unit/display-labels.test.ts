import {
  aiOperationLabel,
  aiUsageStatusLabels,
  assignmentProgressLabels,
  assignmentStatusLabels,
  auditActionLabels,
  auditTargetTypeLabel,
  courseStatusLabels,
  gapStatusLabels,
  materialStatusLabels,
  userRoleLabels,
  userStatusLabels,
} from "@/lib/display-labels";

describe("display labels", () => {
  it("provides Chinese labels for every persisted status value", () => {
    const labelMaps = [
      userRoleLabels,
      userStatusLabels,
      assignmentStatusLabels,
      assignmentProgressLabels,
      courseStatusLabels,
      materialStatusLabels,
      gapStatusLabels,
      aiUsageStatusLabels,
      auditActionLabels,
    ];

    for (const labels of labelMaps) {
      for (const [value, label] of Object.entries(labels)) {
        expect(label).not.toBe(value);
        expect(label).toMatch(/[\u3400-\u9fff]/);
      }
    }

    expect(userRoleLabels.TEACHER).toBe("教师");
    expect(courseStatusLabels.PUBLISHED).toBe("已发布");
    expect(materialStatusLabels.PROCESSING).toBe("处理中");
    expect(gapStatusLabels.RESOLVED).toBe("已解决");
    expect(aiUsageStatusLabels.FAILED).toBe("失败");
  });

  it("localizes known AI operations and audit targets", () => {
    expect(aiOperationLabel("coach")).toBe("苏格拉底追问");
    expect(aiOperationLabel("material_keywords")).toBe("材料关键词提取");
    expect(auditTargetTypeLabel("LearningSession")).toBe("学习会话");
  });

  it("preserves unknown diagnostic values instead of hiding them", () => {
    expect(aiOperationLabel("future_operation")).toBe("future_operation");
    expect(auditTargetTypeLabel("FutureTarget")).toBe("FutureTarget");
  });
});
