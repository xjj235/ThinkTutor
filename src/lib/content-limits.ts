// Teacher content must remain valid when it becomes a student's learning task.
export const curriculumTextLimits = {
  courseTitle: 120,
  chapterTitle: 120,
  goalTitle: 160,
  goalObjective: 2_000,
  learnerLevel: 100,
  assignmentTitle: 160,
  assignmentInstructions: 4_000,
  description: 2_000,
} as const;

export const textLimits = {
  course: curriculumTextLimits.courseTitle,
  chapter: curriculumTextLimits.chapterTitle,
  topic: Math.max(curriculumTextLimits.goalTitle, curriculumTextLimits.assignmentTitle),
  // An assignment without a separate goal uses its instructions as the objective.
  objective: Math.max(curriculumTextLimits.goalObjective, curriculumTextLimits.assignmentInstructions),
  learnerLevel: curriculumTextLimits.learnerLevel,
  referenceText: 8_000,
  clientRequestId: 80,
} as const;
