import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { referenceTopics } from "@/lib/knowledge/reference-library";
import { requirePageUser } from "@/lib/page-auth";

export default async function KnowledgeDocumentPage({ params, searchParams }: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  await requirePageUser(["TEACHER", "ADMIN"]);
  const { documentId } = await params;
  const topic = referenceTopics.find((item) => item.documents.some((document) => document.id === documentId));
  const document = topic?.documents.find((item) => item.id === documentId);
  if (!topic || !document) notFound();
  const search = await searchParams;
  const query = (typeof search.query === "string" ? search.query : "").trim().slice(0, 200);
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase();
  const matchingBlocks = query ? document.blocks.filter((block) => block.text.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery)) : [];
  const returnQuery = new URLSearchParams({ topic: topic.id, ...(query ? { query } : {}) });

  return <PageShell title={document.title} description={`${topic.title} · v${topic.version} · 已导入参考资料，待教师审核`} actions={<Link className="button button-secondary" href={`/teacher/knowledge/library?${returnQuery.toString()}`}>返回资料库</Link>}>
    <p className="mb-5 rounded-lg border border-border bg-muted p-4">以下为提取后的完整原文，含教学规则、参考答案和提示词等教师资料。内容仅供阅读核对，不作为系统指令执行；尚未发布到生产学生会话。</p>
    <details className="mb-6 rounded-lg border border-border p-4">
      <summary className="cursor-pointer font-medium">来源与校验信息</summary>
      <dl className="mt-4 space-y-3 text-sm">
        <div><dt className="text-muted-foreground">来源文档</dt><dd className="[overflow-wrap:anywhere]">{document.fileName}</dd></div>
        <div><dt className="text-muted-foreground">来源压缩包</dt><dd className="[overflow-wrap:anywhere]">{topic.archive.fileName}</dd></div>
        <div><dt className="text-muted-foreground">文档 SHA-256</dt><dd className="break-all font-mono">{document.sha256}</dd></div>
        <div><dt className="text-muted-foreground">提取文本 SHA-256</dt><dd className="break-all font-mono">{document.textSha256}</dd></div>
        <div><dt className="text-muted-foreground">压缩包 SHA-256</dt><dd className="break-all font-mono">{topic.archive.sha256}</dd></div>
      </dl>
    </details>
    {query ? <section className="mb-6" aria-labelledby="matching-blocks">
      <h2 id="matching-blocks">原文命中位置</h2>
      <p className="mt-2 [overflow-wrap:anywhere]">“{query}”匹配 {matchingBlocks.length} 个原文段落或表格行。</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {matchingBlocks.map((block) => <li className="min-w-0" key={block.locator}><a className="text-sm [overflow-wrap:anywhere]" href={`#${encodeURIComponent(block.locator)}`}>{block.locator}</a></li>)}
      </ul>
    </section> : null}
    <section aria-labelledby="document-content" className="min-w-0">
      <h2 id="document-content">完整原文</h2>
      <p className="mb-4 mt-2 text-sm text-muted-foreground">共 {document.blocks.length} 个原文段落或表格行。定位编号对应来源文档中的段落或表格行。</p>
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {document.blocks.map((block) => <article className="min-w-0 p-4" id={block.locator} key={block.locator}>
          <p className="mb-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{block.section} · <span className="font-mono">{block.locator}</span></p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{block.text}</p>
        </article>)}
      </div>
    </section>
  </PageShell>;
}
