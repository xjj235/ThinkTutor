import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell, EmptyState } from "@/components/page-shell";
import { KnowledgeReviewForm } from "@/components/knowledge-review-forms";
import { ReviewTabs } from "@/components/review-tabs";
import { buildV12Manifest } from "@/lib/knowledge/v12-resources";
import { goldenSetSchema, sourceReviewsSchema, goldenValidationSchema } from "@/lib/knowledge/review-schemas";
import { validateKnowledgeManifests, knowledgeManifestSchema } from "@/lib/knowledge/schemas";

export default async function KnowledgeReviewPage() {
  await requirePageUser(["TEACHER", "ADMIN"]);
  const record = await prisma.knowledgeRelease.findUnique({ where: { id: "KR_SR_1_2" } });
  const savedManifest = knowledgeManifestSchema.safeParse(record?.manifest);
  const manifest = savedManifest.success ? savedManifest.data : buildV12Manifest();
  const sources = record ? sourceReviewsSchema.parse(record.sourceReviews) : [];
  const samples = record ? goldenSetSchema.parse(record.goldenSet) : [];
  const validation = validateKnowledgeManifests([record?.manifest ?? manifest]);
  const modelCheck = goldenValidationSchema.safeParse(record?.modelValidation);
  const resources = manifest.v12!;
  const units = [...manifest.knowledgeUnits.map(({ id, title }) => ({ id, title })), ...resources.competencies.map(({ id, description }) => ({ id, title: description }))];
  const editable = record && record.status === "DRAFT";
  const overview = <section className="review-overview">
    <h2>版本与发布</h2>
    <dl className="review-facts"><div><dt>版本编号</dt><dd>KR_SR_1_2</dd></div><div><dt>资源完整性</dt><dd>{validation.errors.length ? validation.errors.join("；") : "校验通过"}</dd></div><div><dt>教师签署</dt><dd>{record?.verifiedBy ? `${record.verifiedBy} · ${record.verifiedAt?.toISOString()}` : "待签署"}</dd></div></dl>
    {modelCheck.success ? <details><summary>模型校准：{modelCheck.data.passed ? "通过" : "未通过"} ({modelCheck.data.modelProvider})</summary>{modelCheck.data.results.map((result) => <p key={result.id} className="break-all">{result.id}：{result.passed ? "通过" : result.differences.join("，")}</p>)}</details> : <p className="muted-copy">模型校准尚未执行</p>}
    <details><summary>v1.2 版本变更</summary><ul className="list-disc pl-5"><li>证据驱动诊断、知识单元状态与错误生命周期</li><li>006A/006B 独立分组、8 项关系与 3 项能力目标</li><li>案例独立验证、反思修订与最终评分证据窗口</li></ul></details>
    {record ? <KnowledgeReviewForm kind="STATUS" version={record.version} /> : <KnowledgeReviewForm kind="CREATE" />}
  </section>;
  const records = <section><h2>审核记录</h2>{!sources.length && !samples.length ? <EmptyState title="尚无审核记录" description="当前版本尚未提交来源确认或教师校准样例。" /> : null}
    {manifest.sources.map((source) => <details className="review-source" key={source.id}><summary>{source.title}</summary><p className="break-all">{source.location}</p><p className="break-all">SHA-256：{source.checksum}</p><p>状态：{source.status}</p></details>)}
    {sources.map((source) => <div className="review-source" key={source.unitId}><strong>{source.title}</strong><span>{source.author} · {source.year} · {source.location}</span><small className="break-all">{source.unitId} · {source.checksum} · {source.verifiedBy} · {source.verifiedAt}</small></div>)}
    {samples.map((sample) => <details className="review-sample" key={sample.id}><summary>{units.find((unit) => unit.id === sample.targetId)?.title ?? sample.targetId} / {sample.expectedLevel}</summary><p className="break-words">{sample.studentAnswer}</p>{editable ? <KnowledgeReviewForm kind="REMOVE_GOLDEN" version={record.version} sampleId={sample.id} /> : null}</details>)}
  </section>;
  return <PageShell title="系统性风险知识审核" description="知识溯源、教师校准与版本发布。" actions={<Link className="button button-secondary" href="/teacher/knowledge/claims">学生判断复核<ArrowUpRight size={15} aria-hidden="true" /></Link>}>
    <div className="release-summary"><div><span>版本状态</span><strong>{({ DRAFT: "待审核", FROZEN: "候选已冻结", REVIEWED: "审核通过", PUBLISHED: "已发布", ARCHIVED: "已归档" })[record?.status ?? "DRAFT"]}</strong></div><div><span>来源确认</span><strong>{sources.length} / 13</strong></div><div><span>教师校准样例</span><strong>{samples.length} / 20</strong></div></div>
    <ReviewTabs tabs={[
      { id: "overview", label: "版本概览", content: overview },
      ...(editable ? [
        { id: "sources", label: "来源确认", content: <section><h2>知识来源确认</h2><KnowledgeReviewForm kind="SOURCE" version={record.version} units={units.filter((unit) => !unit.id.startsWith("COMP_"))} /></section> },
        { id: "rules", label: "规则核验", content: <section><h2>教学规则来源核验</h2><KnowledgeReviewForm kind="PEDAGOGY" version={record.version} units={resources.pedagogyRules.map((r) => ({ id: r.id, title: r.description }))} /></section> },
        { id: "calibration", label: "样例校准", content: <section><h2>教师校准样例</h2><KnowledgeReviewForm kind="GOLDEN" version={record.version} units={units} evidence={Object.entries(resources.evidenceDefinitions).map(([id, label]) => ({ id, label }))} gaps={Object.entries(resources.gaps).map(([id, target]) => ({ id, label: units.find((u) => u.id === target)?.title ?? id }))} errors={Object.entries(resources.errors).map(([id, error]) => ({ id, label: resources.evidenceDefinitions[error.evidenceId] ?? id }))} /></section> },
      ] : []),
      { id: "records", label: "审核记录", content: records },
    ]} />
  </PageShell>;
}
