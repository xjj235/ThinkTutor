import Link from "next/link";
import { EmptyState, PageShell } from "@/components/page-shell";
import { referenceTopics } from "@/lib/knowledge/reference-library";
import { requirePageUser } from "@/lib/page-auth";

export default async function KnowledgeLibraryPage({ searchParams }: {
  searchParams: Promise<{ query?: string | string[]; topic?: string | string[] }>;
}) {
  await requirePageUser(["TEACHER", "ADMIN"]);
  const params = await searchParams;
  const query = (typeof params.query === "string" ? params.query : "").trim().slice(0, 200);
  const selectedTopic = typeof params.topic === "string" ? params.topic : "";
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase();
  const matches = (text: string) => text.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery);
  const topics = referenceTopics.filter((topic) => !selectedTopic || topic.id === selectedTopic).map((topic) => ({
    ...topic,
    documents: topic.documents.filter((document) => !query || matches(`${topic.title} ${document.title} ${document.fileName}`)
      || document.blocks.some((block) => matches(`${block.section} ${block.text}`))),
  })).filter((topic) => topic.documents.length > 0);
  const documentCount = referenceTopics.reduce((total, topic) => total + topic.documents.length, 0);
  const resultCount = topics.reduce((total, topic) => total + topic.documents.length, 0);

  return <PageShell title="知识资料库" description="浏览五类金融风险资料，按主题和原文内容检索。" actions={<Link className="button button-secondary" href="/teacher/knowledge">返回知识审核</Link>}>
    <div className="mb-6 space-y-2 rounded-lg border border-border bg-muted p-4">
      <p><strong>已导入 {referenceTopics.length} 个主题、{documentCount} 份参考文档 · v1.2.1</strong></p>
      <p>全部原文已索引，可供教师检索和核对；资料待教师审核，尚未发布到生产学生会话。</p>
      <p className="text-sm text-muted-foreground">学科知识单元可在启用草稿知识的开发或测试预览中使用。文档中的提示词和教学规则仅作为参考原文，不会自动变更系统规则。</p>
    </div>
    <form className="filter-form" action="/teacher/knowledge/library" method="get" role="search" aria-label="检索知识资料">
      <label>全文搜索<input type="search" name="query" defaultValue={query} maxLength={200} placeholder="输入知识点、句子或文档名称" /></label>
      <label>风险主题<select name="topic" defaultValue={selectedTopic}>
        <option value="">全部主题</option>
        {referenceTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
      </select></label>
      <button className="button" type="submit">搜索资料</button>
      <Link className="button button-secondary" href="/teacher/knowledge/library">清除筛选</Link>
    </form>
    <p className="mb-5 text-sm text-muted-foreground" role="status">找到 {resultCount} 份文档{query ? `，关键词“${query}”` : ""}。</p>
    {topics.length ? <div className="space-y-8">{topics.map((topic) => <section className="min-w-0" key={topic.id} aria-labelledby={`topic-${topic.id}`}>
      <h2 id={`topic-${topic.id}`}>{topic.title}</h2>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">{topic.documents.length} 份文档 · v{topic.version} · 待教师审核</p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {topic.documents.map((document) => {
          const hit = query ? document.blocks.find((block) => matches(block.text)) : undefined;
          return <li className="min-w-0 p-4" key={document.id}>
            <Link className="font-medium [overflow-wrap:anywhere]" href={`/teacher/knowledge/library/${document.id}${query ? `?query=${encodeURIComponent(query)}` : ""}`}>{document.title}</Link>
            <p className="mt-1 text-sm text-muted-foreground">{document.blocks.length} 个原文段落或表格行 · 查看全文与来源</p>
            {hit ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{hit.locator}：{hit.text}</p> : null}
          </li>;
        })}
      </ul>
    </section>)}</div> : <EmptyState title="没有找到匹配资料" description="尝试更短的关键词，或清除主题筛选后重新搜索。" />}
  </PageShell>;
}
