import "server-only";

import { prisma } from "../db";
import type { RetrievedChunk, RetrievalProvider, RetrievalQuery } from "./types";

function terms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{Script=Han}]{2,8}|[a-z][a-z0-9-]{2,}/gu) ?? [])].slice(0, 12);
}

function score(content: string, keywords: string[], queryTerms: string[]): number {
  const normalized = content.toLowerCase();
  return queryTerms.reduce((total, term) => total + (normalized.includes(term) ? 2 : 0) + (keywords.includes(term) ? 3 : 0), 0);
}

export class LexicalCourseRetriever implements RetrievalProvider {
  async retrieve(input: RetrievalQuery): Promise<RetrievedChunk[]> {
    const queryTerms = terms(input.query);
    if (!queryTerms.length) return [];
    const chunks = await prisma.materialChunk.findMany({
      where: {
        courseId: input.courseId,
        chapterId: input.chapterId,
        material: { status: "READY", deletedAt: null },
        OR: queryTerms.flatMap((term) => [
          { searchText: { contains: term, mode: "insensitive" as const } },
          { keywords: { has: term } },
        ]),
      },
      select: { id: true, materialId: true, content: true, keywords: true },
      take: Math.min(50, input.limit * 8),
    });
    return chunks
      .map((chunk) => ({
        id: chunk.id,
        materialId: chunk.materialId,
        content: chunk.content,
        score: score(chunk.content, chunk.keywords, queryTerms),
        resourceType: "MATERIAL_CHUNK" as const,
        visibility: "STUDENT" as const,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit);
  }
}