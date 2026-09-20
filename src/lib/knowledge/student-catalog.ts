import "server-only";

import { AppError } from "../errors";
import { referenceKnowledgeUnits, referenceTopics } from "./reference-library";
import { knowledgeSelectionSchema, studentKnowledgeTopicSchema, type KnowledgeSelection, type StudentKnowledgeTopic } from "./student-catalog-schema";

// Only public topic labels and learning objectives cross the server boundary.
// Selecting a subject does not publish its draft sources or change retrieval gates.
export function getStudentKnowledgeCatalog(): StudentKnowledgeTopic[] {
  return referenceTopics.map((topic) => studentKnowledgeTopicSchema.parse({
    id: topic.id,
    title: topic.title,
    objective: `理解${topic.title}的核心概念、风险来源与传导机制，并结合案例进行判断。`,
    units: referenceKnowledgeUnits.filter((unit) => unit.topicId === topic.id).map((unit) => {
      const standard = topic.documents[0].blocks.find((block) => block.locator === unit.locator)?.text.split(" | ")[3];
      if (!standard) throw new Error(`Missing learning objective for ${unit.id}`);
      return {
        id: unit.id,
        title: unit.title.replace(/\s*\[[^\]]+\]\s*$/u, "").trim(),
        objective: `${topic.title}：${standard}`,
      };
    }),
  }));
}

export function resolveKnowledgeSelection(input: KnowledgeSelection): { course: string; chapter: string; topic: string; objective: string } {
  const selection = knowledgeSelectionSchema.parse(input);
  const topic = getStudentKnowledgeCatalog().find((item) => item.id === selection.topicId);
  if (!topic) throw new AppError("VALIDATION_ERROR", "所选风险主题不存在，请重新选择。", 400);
  const unit = selection.unitId ? topic.units.find((item) => item.id === selection.unitId) : undefined;
  if (selection.unitId && !unit) throw new AppError("VALIDATION_ERROR", "所选知识点不属于该风险主题，请重新选择。", 400);
  return {
    course: "金融风险管理",
    chapter: topic.title,
    topic: unit ? `${topic.title} · ${unit.title}` : topic.title,
    objective: unit?.objective ?? topic.objective,
  };
}

export function isStudentKnowledgeTaskTopic(value: string): boolean {
  return getStudentKnowledgeCatalog().some((topic) => value === topic.title || topic.units.some((unit) => value === `${topic.title} · ${unit.title}`));
}
