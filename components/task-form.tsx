"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  ApiResponse,
  SessionPayload,
  createSessionInputSchema,
} from "@/lib/contracts";

type FormState = {
  course: string;
  chapter: string;
  topic: string;
  goal: string;
  learnerLevel: string;
  referenceText: string;
};

const initialForm: FormState = {
  course: "",
  chapter: "",
  topic: "",
  goal: "",
  learnerLevel: "",
  referenceText: "",
};

export function TaskForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = createSessionInputSchema.safeParse(form);

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
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const result = (await response.json()) as ApiResponse<SessionPayload>;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
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
      className="space-y-5"
      aria-describedby={error ? "task-error" : undefined}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="course"
          label="课程（可选）"
          value={form.course}
          error={fieldErrors.course}
          onChange={(value) => updateField("course", value)}
          maxLength={80}
        />
        <Field
          id="chapter"
          label="章节（可选）"
          value={form.chapter}
          error={fieldErrors.chapter}
          onChange={(value) => updateField("chapter", value)}
          maxLength={120}
        />
      </div>

      <Field
        id="topic"
        label="知识点"
        value={form.topic}
        error={fieldErrors.topic}
        onChange={(value) => updateField("topic", value)}
        required
        maxLength={120}
      />

      <TextArea
        id="goal"
        label="学习目标"
        value={form.goal}
        error={fieldErrors.goal}
        onChange={(value) => updateField("goal", value)}
        required
        maxLength={400}
        rows={4}
      />

      <div className="space-y-2">
        <label
          htmlFor="learnerLevel"
          className="block text-sm font-medium text-[#213236]"
        >
          学习者水平
        </label>
        <select
          id="learnerLevel"
          value={form.learnerLevel}
          onChange={(event) => updateField("learnerLevel", event.target.value)}
          required
          className="w-full rounded-md border border-[#c9d9d7] bg-white px-3 py-2 text-[#172126]"
        >
          <option value="">请选择</option>
          <option value="入门">入门</option>
          <option value="有基础">有基础</option>
          <option value="进阶">进阶</option>
        </select>
        {fieldErrors.learnerLevel ? (
          <p className="text-sm text-[#b42318]">{fieldErrors.learnerLevel}</p>
        ) : null}
      </div>

      <TextArea
        id="referenceText"
        label="教师或课程参考材料（可选）"
        value={form.referenceText}
        error={fieldErrors.referenceText}
        onChange={(value) => updateField("referenceText", value)}
        maxLength={6000}
        rows={6}
      />

      {error ? (
        <p id="task-error" role="alert" className="text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#0f766e] px-5 py-2.5 font-medium text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:bg-[#94b8b4]"
      >
        {pending ? "正在创建..." : "创建并开始学习"}
      </button>
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
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-[#213236]">
        {label}
      </label>
      <input
        id={id}
        value={value}
        required={required}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[#c9d9d7] bg-white px-3 py-2 text-[#172126]"
      />
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
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
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  maxLength: number;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-[#213236]">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        required={required}
        rows={rows}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border border-[#c9d9d7] bg-white px-3 py-2 text-[#172126]"
      />
      <div className="flex justify-between gap-3 text-xs text-[#5d6b70]">
        {error ? <span className="text-[#b42318]">{error}</span> : <span />}
        <span>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
}
