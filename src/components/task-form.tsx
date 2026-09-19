"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  ApiResponse,
  SessionPayload,
  createSessionInputSchema,
  isApiFailure,
  textLimits,
} from "@/lib/contracts";
import type { KnowledgeSelection, StudentKnowledgeTopic } from "@/lib/knowledge/student-catalog-schema";

type FormState = {
  courseId: string;
  chapterId: string;
  learningGoalId: string;
  course: string;
  chapter: string;
  topic: string;
  objective: string;
  learnerLevel: string;
  referenceText: string;
};

const initialForm: FormState = {
  courseId: "",
  chapterId: "",
  learningGoalId: "",
  course: "",
  chapter: "",
  topic: "",
  objective: "",
  learnerLevel: "",
  referenceText: "",
};

type CurriculumCourse = {
  id: string;
  title: string;
  chapters: Array<{
    id: string;
    title: string;
    goals: Array<{ id: string; title: string; objective: string; expectedLevel: string | null }>;
  }>;
};

export function TaskForm({ courses = [], knowledgeTopics = [], referencePreviewEnabled = false }: {
  courses?: CurriculumCourse[];
  knowledgeTopics?: StudentKnowledgeTopic[];
  referencePreviewEnabled?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [knowledgeSelection, setKnowledgeSelection] = useState<KnowledgeSelection>();
  const selectedKnowledgeTopic = knowledgeTopics.find((topic) => topic.id === knowledgeSelection?.topicId);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [unresolvedRequest, setUnresolvedRequest] = useState(false);
  const [creationRejected, setCreationRejected] = useState(false);
  const creationRejectedRef = useRef(false);
  const submittingRef = useRef(false);
  const unresolvedRequestRef = useRef(false);
  const clientRequestIdRef = useRef<string | null>(null);
  const interactionLocked = pending || unresolvedRequest;

  function updateField(field: keyof FormState, value: string) {
    if (submittingRef.current || unresolvedRequestRef.current) return;
    clientRequestIdRef.current = null;
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  function selectKnowledge(topicId: string, unitId?: string) {
    if (submittingRef.current || unresolvedRequestRef.current) return;
    clientRequestIdRef.current = null;
    setFieldErrors({});
    setError("");
    const topic = knowledgeTopics.find((item) => item.id === topicId);
    if (!topic) {
      setKnowledgeSelection(undefined);
      return;
    }
    const unit = topic.units.find((item) => item.id === unitId);
    setKnowledgeSelection({ topicId: topic.id, ...(unit ? { unitId: unit.id } : {}) });
    setForm((current) => ({
      ...current,
      courseId: "",
      chapterId: "",
      learningGoalId: "",
      course: "金融风险管理",
      chapter: topic.title,
      topic: unit ? `${topic.title} · ${unit.title}` : topic.title,
      objective: unit?.objective ?? topic.objective,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || creationRejectedRef.current) return;
    setError("");
    const parsed = createSessionInputSchema.safeParse({
      ...form,
      courseId: form.courseId || undefined,
      chapterId: form.chapterId || undefined,
      learningGoalId: form.learningGoalId || undefined,
      knowledgeSelection,
    });

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors(
        Object.fromEntries(
          Object.entries(flattened).map(([key, value]) => [
            key,
            value?.[0] ?? "",
          ]),
        ),
      );
      return;
    }

    submittingRef.current = true;
    setPending(true);
    let navigating = false;
    try {
      clientRequestIdRef.current ??= crypto.randomUUID();
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...parsed.data, clientRequestId: clientRequestIdRef.current }),
      });
      const result = (await response.json()) as ApiResponse<SessionPayload>;
      if (isApiFailure(result)) {
        if (response.status >= 500 && !result.error.code.startsWith("AI_")) throw new Error("Uncertain creation result");
        if (unresolvedRequestRef.current && response.status >= 400 && response.status < 500 && !result.error.retryable) {
          creationRejectedRef.current = true;
          setCreationRejected(true);
        }
        setError(result.error.message);
        return;
      }
      router.push(`/session/${result.data.session.id}`);
      navigating = true;
    } catch {
      unresolvedRequestRef.current = true;
      setUnresolvedRequest(true);
      setError("暂时无法确认任务是否创建，已保留原选题与内容。请重试创建任务，避免重复创建。");
    } finally {
      if (!navigating) {
        submittingRef.current = false;
        setPending(false);
      }
    }
  }

  return (
    <form
      onSubmit={submit}
      className="task-form"
      aria-describedby={error ? "task-error" : undefined}
      aria-busy={pending}
      noValidate
    >
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-destructive">*</span> 必填信息
      </p>
      {knowledgeTopics.length ? <fieldset className="curriculum-picker">
        <legend>知识库研习</legend>
        <p>选择风险主题，可开展综合学习，也可聚焦一个知识单元。</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="curriculum-field">
            <label htmlFor="knowledge-topic">风险主题</label>
            <select id="knowledge-topic" value={knowledgeSelection?.topicId ?? ""} disabled={interactionLocked} onChange={(event) => selectKnowledge(event.target.value)}
              aria-invalid={Boolean(fieldErrors.knowledgeSelection)} aria-describedby={fieldErrors.knowledgeSelection ? "knowledge-selection-error" : "knowledge-preview-note"}>
              <option value="">请选择风险主题</option>
              {knowledgeTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
            </select>
          </div>
          <div className="curriculum-field">
            <label htmlFor="knowledge-unit">知识库单元</label>
            <select id="knowledge-unit" value={knowledgeSelection?.unitId ?? ""} disabled={interactionLocked || !selectedKnowledgeTopic} onChange={(event) => selectKnowledge(knowledgeSelection?.topicId ?? "", event.target.value || undefined)}>
              <option value="">主题综合学习</option>
              {(selectedKnowledgeTopic?.units ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}
            </select>
          </div>
        </div>
        <p id="knowledge-preview-note" className="mt-4 text-sm text-muted-foreground">{referencePreviewEnabled ? "配套资料已用于本次开发预览。" : "按所选主题开展自主研习；配套资料待审核。"}</p>
        {fieldErrors.knowledgeSelection ? <p id="knowledge-selection-error" role="alert" className="text-sm text-destructive">{fieldErrors.knowledgeSelection}</p> : null}
        {knowledgeSelection ? <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">已自动填写知识点与学习目标；如需编辑，可改为自定义。</p>
          <button className="button button-secondary button-small" type="button" disabled={interactionLocked} onClick={() => selectKnowledge("")}>改为自定义</button>
        </div> : null}
      </fieldset> : null}
      <fieldset className="curriculum-picker">
        <legend>课程关联</legend>
        <p>所在班级已发布的课程与学习目标</p>
        {courses.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="curriculum-field">
              <label htmlFor="curriculum-course">课程</label>
              <select id="curriculum-course" value={form.courseId} disabled={interactionLocked} onChange={(event) => {
                if (submittingRef.current || unresolvedRequestRef.current) return;
                clientRequestIdRef.current = null;
                const course = courses.find((item) => item.id === event.target.value);
                setKnowledgeSelection(undefined);
                setFieldErrors({});
                setError("");
                setForm((current) => ({ ...current, courseId: course?.id ?? "", chapterId: "", learningGoalId: "", course: course?.title ?? "", chapter: "", ...(current.learningGoalId || knowledgeSelection ? { topic: "", objective: "" } : {}) }));
              }}>
                <option value="">不绑定课程</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
              </select>
            </div>
            <div className="curriculum-field">
              <label htmlFor="curriculum-chapter">章节</label>
              <select id="curriculum-chapter" value={form.chapterId} disabled={interactionLocked || !form.courseId} onChange={(event) => {
                if (submittingRef.current || unresolvedRequestRef.current) return;
                clientRequestIdRef.current = null;
                const course = courses.find((item) => item.id === form.courseId);
                const chapter = course?.chapters.find((item) => item.id === event.target.value);
                setKnowledgeSelection(undefined);
                setFieldErrors({});
                setError("");
                setForm((current) => ({ ...current, chapterId: chapter?.id ?? "", learningGoalId: "", chapter: chapter?.title ?? "", ...(current.learningGoalId ? { topic: "", objective: "" } : {}) }));
              }}>
                <option value="">请选择章节</option>
                {(courses.find((item) => item.id === form.courseId)?.chapters ?? []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </div>
            <div className="curriculum-field">
              <label htmlFor="curriculum-goal">学习目标</label>
              <select id="curriculum-goal" value={form.learningGoalId} disabled={interactionLocked || !form.chapterId} onChange={(event) => {
                if (submittingRef.current || unresolvedRequestRef.current) return;
                clientRequestIdRef.current = null;
                const chapter = courses.find((item) => item.id === form.courseId)?.chapters.find((item) => item.id === form.chapterId);
                const goal = chapter?.goals.find((item) => item.id === event.target.value);
                setKnowledgeSelection(undefined);
                setFieldErrors({});
                setError("");
                setForm((current) => ({ ...current, learningGoalId: goal?.id ?? "", topic: goal?.title ?? current.topic, objective: goal?.objective ?? current.objective }));
              }}>
                <option value="">请选择学习目标</option>
                {(courses.find((item) => item.id === form.courseId)?.chapters.find((item) => item.id === form.chapterId)?.goals ?? []).map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
              </select>
            </div>
          </div>
        ) : <p className="curriculum-empty">暂无已发布课程 · 自主研习</p>}
      </fieldset>
      <fieldset className="form-section">
        <legend>研习目标</legend>
        <div className="form-grid">
      <Field
        id="topic"
        label="知识点"
        value={form.topic}
        error={fieldErrors.topic}
        onChange={(value) => updateField("topic", value)}
        required
        maxLength={textLimits.topic}
        disabled={interactionLocked}
        readOnly={Boolean(knowledgeSelection)}
      />

      <div className="space-y-2">
        <label
          htmlFor="learnerLevel"
          className="block text-sm font-medium text-foreground"
        >
          学习者水平 <RequiredMark />
        </label>
        <select
          id="learnerLevel"
          value={form.learnerLevel}
          onChange={(event) => updateField("learnerLevel", event.target.value)}
          required
          disabled={interactionLocked}
          aria-invalid={Boolean(fieldErrors.learnerLevel)}
          aria-describedby={
            fieldErrors.learnerLevel ? "learnerLevel-error" : undefined
          }
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-foreground"
        >
          <option value="">请选择</option>
          <option value="入门">基础认知</option>
          <option value="有基础">已有基础</option>
          <option value="进阶">进阶研习</option>
        </select>
        {fieldErrors.learnerLevel ? (
          <p id="learnerLevel-error" className="text-sm text-destructive">
            {fieldErrors.learnerLevel}
          </p>
        ) : null}
      </div>

      <div className="form-wide">
        <TextArea
          id="objective"
          label="学习目标"
          value={form.objective}
          error={fieldErrors.objective}
          onChange={(value) => updateField("objective", value)}
          required
          maxLength={textLimits.objective}
          rows={3}
          disabled={interactionLocked}
          readOnly={Boolean(knowledgeSelection)}
        />
      </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>补充资料</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="course"
          label="课程（可选）"
          value={form.course}
          error={fieldErrors.course}
          onChange={(value) => updateField("course", value)}
          maxLength={textLimits.course}
          disabled={interactionLocked}
          readOnly={Boolean(form.courseId || knowledgeSelection)}
        />
        <Field
          id="chapter"
          label="章节（可选）"
          value={form.chapter}
          error={fieldErrors.chapter}
          onChange={(value) => updateField("chapter", value)}
          maxLength={textLimits.chapter}
          disabled={interactionLocked}
          readOnly={Boolean(form.chapterId || knowledgeSelection)}
        />
      </div>

      <TextArea
        id="referenceText"
        label="教师或课程参考材料（可选）"
        value={form.referenceText}
        error={fieldErrors.referenceText}
        onChange={(value) => updateField("referenceText", value)}
        maxLength={textLimits.referenceText}
        rows={4}
        disabled={interactionLocked}
      />
      </fieldset>

      {error ? (
        <p id="task-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {creationRejected ? (
        <section className="space-y-3 rounded-md border border-border p-4" aria-label="创建任务恢复">
          <p className="text-sm leading-6">本次重试已被拒绝，仍无法确认之前的创建结果。已输入内容保留在本页；离开或刷新前请先复制，并到学习总览查看是否已创建任务。</p>
          <label className="block text-sm">
            已输入的任务内容
            <textarea
              aria-label="已输入的任务内容"
              readOnly
              rows={8}
              value={[
                "知识点：" + form.topic, "学习目标：" + form.objective, "学习者水平：" + form.learnerLevel,
                "课程：" + form.course, "章节：" + form.chapter, "参考材料：" + form.referenceText,
              ].join("\n")}
              className="mt-2 w-full resize-y rounded-md border border-input bg-card px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard" className="button">返回学习总览</Link>
            <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>刷新任务页面</button>
          </div>
        </section>
      ) : null}

      <div className="form-actions">
      {!creationRejected ? <button
        type="submit"
        disabled={pending}
        className="button"
      >
        {pending ? "正在创建..." : unresolvedRequest ? "重试创建任务" : "创建并开始学习"}
        <ArrowRight size={18} aria-hidden="true" />
      </button> : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  error,
  required,
  maxLength,
  disabled,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  maxLength: number;
  disabled: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label} {required ? <RequiredMark /> : null}
      </label>
      <input
        id={id}
        value={value}
        required={required}
        maxLength={maxLength}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-input bg-card px-3 py-2 text-foreground read-only:bg-muted disabled:cursor-not-allowed disabled:bg-muted"
      />
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        {error ? (
          <span id={`${id}-error`} className="text-destructive">
            {error}
          </span>
        ) : (
          <span />
        )}
        <span id={`${id}-count`}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
}

function TextArea({
  id,
  label,
  value,
  error,
  required,
  maxLength,
  rows,
  disabled,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  maxLength: number;
  rows: number;
  disabled: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label} {required ? <RequiredMark /> : null}
      </label>
      <textarea
        id={id}
        value={value}
        required={required}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-foreground read-only:bg-muted disabled:cursor-not-allowed disabled:bg-muted"
      />
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        {error ? (
          <span id={`${id}-error`} className="text-destructive">
            {error}
          </span>
        ) : (
          <span />
        )}
        <span id={`${id}-count`}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="font-semibold text-destructive">
      *
    </span>
  );
}
