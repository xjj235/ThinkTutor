import { StructuredKnowledgeRetriever } from "./knowledge-retriever";
import { LexicalCourseRetriever } from "./lexical-retriever";
import type { RetrievedChunk, RetrievalProvider, RetrievalQuery } from "./types";
const materialRetrievalLimit = 3;

class HybridCourseRetriever implements RetrievalProvider {
  private readonly structured = new StructuredKnowledgeRetriever();
  private readonly lexical = new LexicalCourseRetriever();

  async retrieve(input: RetrievalQuery): Promise<RetrievedChunk[]> {
    const [structured, lexical] = await Promise.all([
      this.structured.retrieve(input),
      this.lexical.retrieve(input),
    ]);
    const seen = new Set<string>();
    return [...structured, ...lexical.slice(0, materialRetrievalLimit)]
      .filter((chunk) => {
        const key = `${chunk.resourceType ?? "UNKNOWN"}:${chunk.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, input.limit);
  }
}

let retriever: RetrievalProvider | undefined;
export function getCourseRetriever(): RetrievalProvider {
  retriever ??= new HybridCourseRetriever();
  return retriever;
}
export type { RetrievalProvider, RetrievedChunk, VectorCourseRetriever } from "./types";
