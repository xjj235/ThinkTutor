export interface RetrievalQuery {
  courseId: string;
  chapterId?: string;
  query: string;
  limit: number;
}

export interface RetrievedChunk {
  id: string;
  materialId: string;
  content: string;
  score: number;
}

export interface RetrievalProvider {
  retrieve(input: RetrievalQuery): Promise<RetrievedChunk[]>;
}

export interface VectorCourseRetriever extends RetrievalProvider {
  readonly kind: "vector";
}
