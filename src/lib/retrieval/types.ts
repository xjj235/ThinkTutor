export interface RetrievalQuery {
  courseId: string;
  chapterId?: string;
  query: string;
  limit: number;
  phase?: import("../contracts").LearningPhase;
  targetConcept?: string;
  errorTags?: string[];
  usedQuestionIds?: string[];
  usedCaseIds?: string[];
  hintLevel?: 0 | 1 | 2;
  releaseId?: string;
  selectedQuestionId?: string;
  selectedCaseId?: string;
}

export interface RetrievedChunk {
  id: string;
  materialId: string;
  content: string;
  score: number;
  resourceType?: "MATERIAL_CHUNK" | "KNOWLEDGE_UNIT" | "MISCONCEPTION" | "DIAGNOSTIC_QUESTION" | "SOCRATIC_QUESTION" | "HINT" | "CASE" | "RUBRIC";
  visibility?: "STUDENT" | "TEACHER" | "AI_INTERNAL" | "ADMIN";
  knowledgeUnitId?: string;
}

export interface RetrievalProvider {
  retrieve(input: RetrievalQuery): Promise<RetrievedChunk[]>;
}

export interface VectorCourseRetriever extends RetrievalProvider {
  readonly kind: "vector";
}
