"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { dimensionKeys, dimensionLabels } from "@/lib/contracts";

export function KnowledgeReviewForm({ kind, version = 0, units = [], evidence = [], errors = [], gaps = [], sessionId, claimId, sampleId }: {
  kind: "CREATE" | "SOURCE" | "GOLDEN" | "STATUS" | "CLAIM" | "REMOVE_GOLDEN" | "PEDAGOGY"; version?: number; units?: Array<{ id: string; title: string }>; evidence?: Array<{ id: string; label: string }>; errors?: Array<{ id: string; label: string }>; gaps?: Array<{ id: string; label: string }>; sessionId?: string; claimId?: string; sampleId?: string;
}) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const data = new FormData(event.currentTarget); const get = (key: string) => String(data.get(key) ?? "");
    const action = kind === "STATUS" || kind === "CLAIM" ? get("action") : kind;
    const body = kind === "CREATE" ? { action } : kind === "PEDAGOGY" ? { action, version, ruleId: get("ruleId"), sourceTitle: get("sourceTitle"), sourceLocation: get("sourceLocation"), basisType: get("basisType") } : kind === "SOURCE" ? { action, version, source: { unitId: get("unitId"), title: get("title"), author: get("author"), year: Number(get("year")), location: get("location"), checksum: get("checksum") } } : kind === "GOLDEN" ? { action, version, sample: { priorAnswers: get("priorAnswers").split(/\r?\n/u).map((s) => s.trim()).filter(Boolean), caseId: get("caseId") || null, studentAnswer: get("studentAnswer"), targetId: get("targetId"), expectedEvidenceIds: data.getAll("evidence").map(String), expectedErrorIds: data.getAll("errors").map(String), expectedGapIds: data.getAll("gaps").map(String), resolvedClaimIds: data.getAll("resolved").map(String), unresolvedClaimIds: data.getAll("unresolved").map(String), scenarios: data.getAll("scenarios").map(String), expectedLevel: get("level"), dimensionAnchors: Object.fromEntries(dimensionKeys.map((key) => [key, Number(get(key))])) } } : kind === "CLAIM" ? { action, version, sessionId, claimId, note: get("note") } : { action, version };
    setPending(true); setNotice("");
    try {
      const res = await fetch(`/api/teacher/knowledge${kind === "CLAIM" ? "/claims" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(kind === "REMOVE_GOLDEN" ? { ...body, sampleId } : body) });
      const result = await res.json();
      setNotice(res.ok ? "已保存" : result.error?.message ?? "保存失败，请重试。");
      if (res.ok) router.refresh();
    } catch { setNotice("网络请求失败，请重试。"); } finally { setPending(false); }
  }
  const selectUnits = (name: string) => <label>知识目标<select name={name} required>{units.map((u) => <option key={u.id} value={u.id}>{u.title} ({u.id})</option>)}</select></label>;
  return <form onSubmit={submit} className="stack-form max-w-3xl" aria-busy={pending}>
    {kind === "SOURCE" ? <>
      {selectUnits("unitId")}
      <label>来源标题<input name="title" required maxLength={200} /></label>
      <label>作者或机构<input name="author" required maxLength={120} /></label>
      <label>年份<input name="year" type="number" min={1900} max={2200} required /></label>
      <label>来源定位<input name="location" required maxLength={300} /></label>
      <label>来源文件 SHA-256<input name="checksum" required pattern="[a-f0-9]{64}" className="break-all" /></label>
    </> : null}
    {kind === "PEDAGOGY" ? <>
      <label>教学规则<select name="ruleId">{units.map((u) => <option key={u.id} value={u.id}>{u.id} · {u.title}</option>)}</select></label>
      <label>依据类型<select name="basisType"><option value="engineering_interpretation">工程解释</option><option value="project_custom">项目规则</option><option value="theory">教学理论</option></select></label>
      <label>来源标题<input name="sourceTitle" required maxLength={200} /></label>
      <label>章节与页码<input name="sourceLocation" required maxLength={300} /></label>
    </> : null}
    {kind === "GOLDEN" ? <>
      {selectUnits("targetId")}
      <label>学生回答样例<textarea name="studentAnswer" rows={5} required minLength={12} maxLength={4000} /></label>
      <label>前序独立回答（每行一条）<textarea name="priorAnswers" rows={3} maxLength={40000} /></label>
      <label>迁移案例<select name="caseId"><option value="">无</option>{Array.from({ length: 8 }, (_, i) => `CASE_SR_00${i + 1}`).map((id) => <option key={id}>{id}</option>)}</select></label>
      <label>教师判定等级<select name="level">{["L1", "L2", "L3", "L4"].map((l) => <option key={l}>{l}</option>)}</select></label>
      <fieldset><legend>预期证据</legend><div className="max-h-60 overflow-y-auto">{evidence.map(({ id, label }) => <label key={id} className="knowledge-check-option"><input type="checkbox" name="evidence" value={id} /><span>{label}<small>{id}</small></span></label>)}</div></fieldset>
      <fieldset><legend>预期错误</legend>{errors.map(({ id, label }) => <label key={id} className="knowledge-check-option"><input type="checkbox" name="errors" value={id} /><span>{label}<small>{id}</small></span></label>)}</fieldset>
      <fieldset><legend>预期缺口</legend>{gaps.map(({ id, label }) => <label key={id} className="knowledge-check-option"><input type="checkbox" name="gaps" value={id} /><span>{label}<small>{id}</small></span></label>)}</fieldset>
      <fieldset><legend>判断生命周期</legend>{[...errors, ...gaps].map(({ id, label }) => <div key={id} className="border-b py-2"><p>{label}</p><label className="knowledge-check-option"><input type="checkbox" name="resolved" value={id} />已消解</label><label className="knowledge-check-option"><input type="checkbox" name="unresolved" value={id} />未消解</label></div>)}</fieldset>
      <fieldset><legend>验证场景</legend>{Object.entries({ HINT_CORRECTION: "提示后修正", COUNTEREXAMPLE: "反例辨析", FLUENT_WRONG: "表达流畅但判断错误", INSUFFICIENT_EVIDENCE: "证据不足", UNSEEN_PASS: "新案例迁移通过", UNSEEN_FAIL: "新案例迁移未通过" }).map(([id, label]) => <label className="knowledge-check-option" key={id}><input type="checkbox" name="scenarios" value={id} />{label}</label>)}</fieldset>
      {dimensionKeys.map((key) => <label key={key}>{dimensionLabels[key]}<select name={key}>{[0, 5, 10, 15, 20].map((score) => <option key={score}>{score}</option>)}</select></label>)}
    </> : null}
    {kind === "STATUS" ? <label>版本操作<select name="action"><option value="FREEZE">确认完整来源并冻结候选</option><option value="VALIDATE_MODEL">运行模型校准</option><option value="REVIEW">确认审核</option><option value="PUBLISH">发布</option><option value="UNFREEZE">解除冻结并撤销校准</option><option value="REFRESH_DRAFT">升级草稿资源并重置规则核验</option><option value="ARCHIVE">归档</option></select></label> : null}
    {kind === "CLAIM" ? <><label>审核结论<select name="action"><option value="NEED_MORE_EVIDENCE">需要更多证据</option><option value="CONFIRM">确认判断</option><option value="REJECT">驳回判断</option></select></label><label>审核意见<textarea name="note" rows={2} required maxLength={500} /></label></> : null}
    <button className="button" disabled={pending}>{pending ? "保存中..." : kind === "CREATE" ? "建立待审核版本" : kind === "SOURCE" ? "确认来源" : kind === "GOLDEN" ? "确认样例" : kind === "REMOVE_GOLDEN" ? "撤回此样例" : "提交审核操作"}</button>
    <p role="status" className="break-words">{notice}</p>
  </form>;
}
