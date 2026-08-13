import { describe, expect, it } from "vitest";
import { normalizeReportGaps, serializeMessage, serializeSession } from "@/lib/serializers";

describe("report JSON compatibility", () => {
  it("keeps current structured gaps unchanged", () => {
    const gaps = [
      {
        title: "迁移条件",
        evidence: "本次对话未展示新场景分析。",
        repairTask: "分析一个新的应用场景。",
        priority: 5,
      },
    ];

    expect(normalizeReportGaps(gaps)).toEqual(gaps);
  });

  it("normalizes legacy string gaps without inventing mastery evidence", () => {
    expect(normalizeReportGaps(["迁移条件"])).toEqual([
      {
        title: "迁移条件",
        evidence: "旧版报告未保存该漏洞的独立证据，需要复核原始学习对话。",
        repairTask: "围绕“迁移条件”完成一次针对性解释，并补充可核查证据。",
        priority: 3,
      },
    ]);
  });
});

describe("browser DTO data minimization", () => {
  it("does not expose ownership, curriculum foreign keys, raw references, learner state, or message metadata", () => {
    const now = new Date();
    const session = serializeSession({
      id: "session-safe",
      userId: "private-user-id",
      courseId: "private-course-id",
      chapterId: "private-chapter-id",
      learningGoalId: "private-goal-id",
      assignmentId: "private-assignment-id",
      source: "SELF_DIRECTED",
      course: "课程",
      chapter: "章节",
      topic: "知识点",
      objective: "目标",
      learnerLevel: "初学",
      referenceText: "private-reference-text",
      phase: "DIAGNOSIS",
      socraticTurns: 0,
      maxTurns: 6,
      learnerState: { masteryEstimate: 42 },
      contextSummary: "private-context-summary",
      parentSessionId: null,
      sourceGapId: null,
      version: 0,
      startedAt: now,
      completedAt: null,
      abandonedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const message = serializeMessage({
      id: "message-safe",
      sessionId: "private-session-id",
      role: "ASSISTANT",
      phase: "DIAGNOSIS",
      content: "一个问题？",
      questionType: "CONCEPT_CLARIFICATION",
      clientRequestId: null,
      metadata: { transitionReason: "private-reason" },
      createdAt: now,
    });

    expect(session.hasReferenceMaterial).toBe(true);
    for (const key of ["userId", "courseId", "chapterId", "learningGoalId", "assignmentId", "source", "referenceText", "learnerState", "contextSummary"]) {
      expect(session).not.toHaveProperty(key);
    }
    expect(message).not.toHaveProperty("sessionId");
    expect(message).not.toHaveProperty("metadata");
  });
});
