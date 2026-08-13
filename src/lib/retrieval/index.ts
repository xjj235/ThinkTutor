import { LexicalCourseRetriever } from "./lexical-retriever";
import type { RetrievalProvider } from "./types";

let retriever: RetrievalProvider | undefined;
export function getCourseRetriever(): RetrievalProvider {
  retriever ??= new LexicalCourseRetriever();
  return retriever;
}
export type { RetrievalProvider, RetrievedChunk, VectorCourseRetriever } from "./types";
