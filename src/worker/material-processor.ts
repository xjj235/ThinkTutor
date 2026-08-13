import "server-only";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { prisma } from "../lib/db";
import { AppError } from "../lib/errors";
import { getStorageProvider } from "../lib/storage";

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => data[index] === value);
}

async function extractText(kind: "PDF" | "DOCX" | "TXT" | "MARKDOWN", data: Uint8Array): Promise<string> {
  if (kind === "PDF") {
    if (!startsWith(data, [0x25, 0x50, 0x44, 0x46])) throw new AppError("MATERIAL_PROCESSING_ERROR", "PDF 文件签名无效。", 400);
    const parser = new PDFParse({ data });
    try { return (await parser.getText()).text; }
    finally { await parser.destroy(); }
  }
  if (kind === "DOCX") {
    if (!startsWith(data, [0x50, 0x4b])) throw new AppError("MATERIAL_PROCESSING_ERROR", "DOCX 文件签名无效。", 400);
    return (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitLongParagraph(value: string): string[] {
  if (value.length <= 1_200) return [value];
  const sentences = value.split(/(?<=[。！？!?；;])\s*/u).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 1_000) { result.push(current); current = ""; }
    current += sentence;
  }
  if (current) result.push(current);
  return result.length ? result : value.match(/[\s\S]{1,1000}/g) ?? [];
}

export function chunkMaterialText(text: string): string[] {
  const paragraphs = normalizeText(text).split(/\n{2,}/).flatMap(splitLongParagraph).filter((value) => value.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > 1_200) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current.length >= 500) { chunks.push(current); current = ""; }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 500);
}

function lexicalKeywords(content: string): string[] {
  const candidates = content.match(/[\p{Script=Han}]{2,8}|[a-zA-Z][a-zA-Z0-9-]{2,}/gu) ?? [];
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.toLowerCase(), (counts.get(candidate.toLowerCase()) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 16).map(([keyword]) => keyword);
}

export async function processMaterial(materialId: string): Promise<void> {
  const claimed = await prisma.material.updateMany({ where: { id: materialId, status: { in: ["UPLOADED", "QUEUED", "FAILED"] } }, data: { status: "PROCESSING", failureCode: null, failureMessage: null } });
  if (claimed.count === 0) return;
  try {
    const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
    const data = await getStorageProvider().readObject(material.objectKey);
    if (data.byteLength !== material.byteSize) throw new AppError("MATERIAL_PROCESSING_ERROR", "文件大小与上传记录不一致。", 400);
    const text = await extractText(material.kind, data);
    const chunks = chunkMaterialText(text);
    if (!chunks.length) throw new AppError("MATERIAL_PROCESSING_ERROR", "材料中没有可提取的文本。", 422);
    await prisma.$transaction(async (tx) => {
      await tx.materialChunk.deleteMany({ where: { materialId } });
      await tx.materialChunk.createMany({ data: chunks.map((content, chunkIndex) => ({ materialId, courseId: material.courseId, chapterId: material.chapterId, chunkIndex, content, charCount: content.length, tokenCount: Math.ceil(content.length / 2), keywords: lexicalKeywords(content), searchText: content.toLowerCase() })) });
      await tx.material.update({ where: { id: materialId }, data: { status: "READY", processedAt: new Date() } });
    });
  } catch (error) {
    await prisma.material.update({ where: { id: materialId }, data: { status: "FAILED", failureCode: error instanceof AppError ? error.code : "MATERIAL_PROCESSING_ERROR", failureMessage: error instanceof Error ? error.message.slice(0, 500) : "材料处理失败。", retryCount: { increment: 1 } } });
    throw error;
  }
}
