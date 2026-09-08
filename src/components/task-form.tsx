"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  ApiResponse,
  SessionPayload,
  createSessionInputSchema,
  isApiFailure,
} from "@/lib/contracts";

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

export function TaskForm({ courses = [] }: { courses?: CurriculumCourse[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const clientRequestIdRef = useRef<string | null>(null);

  function updateField(field: keyof FormState, value: string) {
    clientRequestIdRef.current = null;
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = createSessionInputSchema.safeParse({
      ...form,
      courseId: form.courseId || undefined,
      chapterId: form.chapterId || undefined,
      learningGoalId: form.learningGoalId || undefined,
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

    setPending(true);
    try {
      clientRequestIdRef.current ??= crypto.randomUUID();
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...parsed.data, clientRequestId: clientRequestIdRef.current }),
      });
      const result = (await response.json()) as ApiResponse<SessionPayload>;
      if (isApiFailure(result)) {
        setError(result.error.message);
        return;
      }
      clientRequestIdRef.current = null;
      router.push(`/session/${result.data.session.id}`);
    } catch {
      setError("网络请求失败，请重试。");
    } finally {
      setPending(false);
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
      <p className="text-sm text-[#5d6b70]">
        <span className="font-semibold text-[#b42318]">*</span> 必填信息
      </p>
      <fieldset className="curriculum-picker">
        <legend>课程关联</legend>
        <p>所在班级已发布的课程与学习目标</p>
        {courses.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="curriculum-field">
              <label htmlFor="curriculum-course">课程</label>
              <select id="curriculum-course" value={form.courseId} disabled={pending} onChange={(event) => {
                clientRequestIdRef.current = null;
                const course = courses.find((item) => item.id === event.target.value);
                setForm((current) => ({ ...current, courseId: course?.id ?? "", chapterId: "", learningGoalId: "", course: course?.title ?? "", chapter: "", ...(current.learningGoalId ? { topic: "", objective: "" } : {}) }));
              }}>
                <option value="">不绑定课程</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
              </select>
            </div>
            <div className="curriculum-field">
              <label htmlFor="curriculum-chapter">章节</label>
              <select id="curriculum-chapter" value={form.chapterId} disabled={pending || !form.courseId} onChange={(event) => {
                clientRequestIdRef.current = null;
                const course = courses.find((item) => item.id === form.courseId);
                const chapter = course?.chapters.find((item) => item.id === event.target.value);
                setForm((current) => ({ ...current, chapterId: chapter?.id ?? "", learningGoalId: "", chapter: chapter?.title ?? "", ...(current.learningGoalId ? { topic: "", objective: "" } : {}) }));
              }}>
                <option value="">请选择章节</option>
                {(courses.find((item) => item.id === form.courseId)?.chapters ?? []).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
              </select>
            </div>
            <div className="curriculum-field">
              <label htmlFor="curriculum-goal">学习目标</label>
              <select id="curriculum-goal" value={form.learningGoalId} disabled={pending || !form.chapterId} onChange={(event) => {
                clientRequestIdRef.current = null;
                const chapter = courses.find((item) => item.id === form.courseId)?.chapters.find((item) => item.id === form.chapterId);
                const goal = chapter?.goals.find((item) => item.id === event.target.value);
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
        maxLength={120}
        disabled={pending}
      />

      <div className="space-y-2">
        <label
          htmlFor="learnerLevel"
          className="block text-sm font-medium text-[#213236]"
        >
          学习者水平 <RequiredMark />
        </label>
        <select
          id="learnerLevel"
          value={form.learnerLevel}
          onChange={(event) => updateField("learnerLevel", event.target.value)}
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.learnerLevel)}
          aria-describedby={
            fieldErrors.learnerLevel ? "learnerLevel-error" : undefined
          }
          className="w-full rounded-md border border-[#c9d9d7] bg-white px-3 py-2 text-[#172126]"
        >
          <option value="">请选择</option>
          <option value="入门">基础认知</option>
          <option value="有基础">已有基础</option>
          <option value="进阶">进阶研习</option>
        </select>
        {fieldErrors.learnerLevel ? (
          <p id="learnerLevel-error" className="text-sm text-[#b42318]">
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
          maxLength={400}
          rows={3}
          disabled={pending}
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
          maxLength={80}
          disabled={pending}
          readOnly={Boolean(form.courseId)}
        />
        <Field
          id="chapter"
          label="章节（可选）"
          value={form.chapter}
          error={fieldErrors.chapter}
          onChange={(value) => updateField("chapter", value)}
          maxLength={120}
          disabled={pending}
          readOnly={Boolean(form.chapterId)}
        />
      </div>

      <TextArea
        id="referenceText"
        label="教师或课程参考材料（可选）"
        value={form.referenceText}
        error={fieldErrors.referenceText}
        onChange={(value) => updateField("referenceText", value)}
        maxLength={8000}
        rows={4}
        disabled={pending}
      />
      </fieldset>

      {error ? (
        <p id="task-error" role="alert" className="text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
      <button
        type="submit"
        disabled={pending}
        className="button disabled:cursor-not-allowed disabled:bg-[#94b8b4]"
      >
        {pending ? "正在创建..." : "创建并开始学习"}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
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
      <label htmlFor={id} className="block text-sm font-medium text-[#213236]">
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
        className="w-full rounded-md border border-[#c9d9d7] bg-white px-3 py-2 text-[#172126] read-only:bg-[#edf2f1] disabled:cursor-not-allowed disabled:bg-[#edf2f1]"
      />
      <div className="flex justify-between gap-3 text-xs text-[#5d6b70]">
        {error ? (
          <span id={`${id}-error`} className="text-[#b42318]">
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
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-[#213236]">
        {label} {required ? <RequiredMark /> : null}
      </label>
      <textarea
        id={id}
        value={value}
        required={required}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border border-[#c9d9d7] bg-white px-3 py-2 text-[#172126] disabled:cursor-not-allowed disabled:bg-[#edf2f1]"
      />
      <div className="flex justify-between gap-3 text-xs text-[#5d6b70]">
        {error ? (
          <span id={`${id}-error`} className="text-[#b42318]">
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
    <span aria-hidden="true" className="font-semibold text-[#b42318]">
      *
    </span>
  );
}
