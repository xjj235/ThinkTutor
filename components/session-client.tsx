"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ApiResponse,
  LearningPhase,
  MessageDTO,
  SessionPayload,
  phaseLabels,
  questionTypeLabels,
} from "@/lib/contracts";
import { PhaseProgress } from "./phase-progress";

function makeRequestId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

async function fetchSessionPayload(sessionId: string) {
  const response = await fetch(`/api/sessions/${sessionId}`, {
    cache: "no-store",
  });
  const result = (await response.json()) as ApiResponse<SessionPayload>;
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

export function SessionClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await fetchSessionPayload(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取会话失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;

    void fetchSessionPayload(sessionId)
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "读取会话失败，请重试。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payload || !answer.trim() || pending) {
      return;
    }

    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answer,
          clientRequestId: makeRequestId("answer"),
        }),
      });
      const result = (await response.json()) as ApiResponse<
        SessionPayload & { duplicate: boolean }
      >;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPayload(result.data);
      setAnswer("");
    } catch {
      setError("提交失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function requestHint() {
    if (!payload || pending) {
      return;
    }

    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/hint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientRequestId: makeRequestId("hint") }),
      });
      const result = (await response.json()) as ApiResponse<
        SessionPayload & { duplicate: boolean }
      >;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPayload(result.data);
    } catch {
      setError("提示生成失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  async function submitFeynman(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payload || explanation.trim().length < 20 || pending) {
      return;
    }

    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/feynman`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          explanation,
          clientRequestId: makeRequestId("feynman"),
        }),
      });
      const result = (await response.json()) as ApiResponse<{
        payload: SessionPayload;
      }>;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/report/${sessionId}`);
    } catch {
      setError("费曼讲解提交失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p aria-live="polite" className="text-[#5d6b70]">
          正在读取学习会话...
        </p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p role="alert" className="text-[#b42318]">
          {error || "会话不存在。"}
        </p>
        <button
          type="button"
          onClick={loadSession}
          className="mt-4 rounded-md border border-[#b9d8d4] px-4 py-2 text-[#115e59]"
        >
          重新加载
        </button>
      </main>
    );
  }

  const { session, messages } = payload;
  const canAnswer = session.phase === "DIAGNOSIS" || session.phase === "SOCRATIC";
  const canHint = canAnswer;
  const canFeynman = session.phase === "FEYNMAN";

  return (
    <main
      className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[320px_1fr]"
      data-parent-session-id={session.parentSessionId ?? ""}
    >
      <aside className="space-y-5 rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-4 lg:sticky lg:top-4 lg:self-start">
        <Link href="/" className="text-sm font-medium text-[#115e59]">
          返回首页
        </Link>
        <div>
          <p className="text-sm text-[#5d6b70]">当前任务</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#172126]">
            {session.topic}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#435257]">
            {session.goal}
          </p>
        </div>
        <dl className="grid gap-3 text-sm">
          <Info label="学习者水平" value={session.learnerLevel} />
          <Info label="课程" value={session.course ?? "未填写"} />
          <Info label="章节" value={session.chapter ?? "未填写"} />
          <Info
            label="关联原会话"
            value={session.parentSessionId ? "已关联" : "无"}
          />
        </dl>
        <PhaseProgress
          phase={session.phase}
          socraticRound={session.socraticRound}
        />
      </aside>

      <section className="space-y-5">
        <div className="rounded-md border border-[#dce7e6] bg-white">
          <div className="border-b border-[#dce7e6] px-4 py-3">
            <h2 className="font-semibold text-[#172126]">学习对话</h2>
            <p className="mt-1 text-sm text-[#5d6b70]">
              {phaseLabels[session.phase]}阶段，系统每次只推进一个问题。
            </p>
          </div>
          <div className="space-y-4 px-4 py-4">
            {messages.length === 0 ? (
              <p className="rounded-md border border-dashed border-[#b9d8d4] p-4 text-sm text-[#5d6b70]">
                暂无消息。
              </p>
            ) : (
              messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))
            )}
          </div>
        </div>

        <div aria-live="polite" className="min-h-6 text-sm text-[#5d6b70]">
          {pending ? "正在生成..." : ""}
        </div>

        {error ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-[#f3b7ae] bg-[#fff7f5] p-4 text-sm text-[#8f1f13] sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={loadSession}
              className="rounded-md border border-[#d69a92] px-3 py-2 font-medium"
            >
              重新加载
            </button>
          </div>
        ) : null}

        {canAnswer ? (
          <form
            onSubmit={submitAnswer}
            className="rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-4"
          >
            <label
              htmlFor="answer"
              className="block text-sm font-medium text-[#213236]"
            >
              你的回答
            </label>
            <textarea
              id="answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={5}
              maxLength={2000}
              className="mt-2 w-full resize-y rounded-md border border-[#c9d9d7] bg-white px-3 py-2"
              placeholder="先写出你的理解，不需要一次答完。"
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[#5d6b70]">
                {answer.length} / 2000
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={requestHint}
                  disabled={!canHint || pending}
                  className="rounded-md border border-[#b9d8d4] px-4 py-2 font-medium text-[#115e59] disabled:cursor-not-allowed disabled:text-[#8aa09d]"
                >
                  申请提示
                </button>
                <button
                  type="submit"
                  disabled={!answer.trim() || pending}
                  className="rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#94b8b4]"
                >
                  提交回答
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {canFeynman ? (
          <form
            onSubmit={submitFeynman}
            className="rounded-md border border-[#b9d8d4] bg-[#eef8f6] p-4"
          >
            <label
              htmlFor="feynman"
              className="block text-sm font-medium text-[#213236]"
            >
              费曼讲解
            </label>
            <textarea
              id="feynman"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              rows={8}
              maxLength={4000}
              className="mt-2 w-full resize-y rounded-md border border-[#b9d8d4] bg-white px-3 py-2"
              placeholder="用自己的话讲给初学者听，包含概念、因果、例子和迁移场景。"
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[#5d6b70]">
                {explanation.length} / 4000，至少 20 字
              </span>
              <button
                type="submit"
                disabled={explanation.trim().length < 20 || pending}
                className="rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#94b8b4]"
              >
                生成学习报告
              </button>
            </div>
          </form>
        ) : null}

        {session.phase === "COMPLETED" ? (
          <div className="rounded-md border border-[#b9d8d4] bg-[#eef8f6] p-4">
            <p className="font-medium text-[#0f3f3b]">学习闭环已完成。</p>
            <Link
              href={`/report/${session.id}`}
              className="mt-3 inline-flex rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white"
            >
              查看学习报告
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#5d6b70]">{label}</dt>
      <dd className="mt-1 font-medium text-[#213236]">{value}</dd>
    </div>
  );
}

function MessageItem({ message }: { message: MessageDTO }) {
  const assistant = message.role === "ASSISTANT";
  const phase = phaseLabels[message.phase as LearningPhase];

  return (
    <article
      className={[
        "rounded-md border p-4",
        assistant
          ? "border-[#dce7e6] bg-[#f7fbfa]"
          : "border-[#c8d8e0] bg-white",
      ].join(" ")}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#5d6b70]">
        <span className="font-semibold text-[#213236]">
          {assistant ? "问思学伴" : "学生"}
        </span>
        <span>{phase}</span>
        {message.questionType ? (
          <span className="rounded-full border border-[#b9d8d4] px-2 py-0.5">
            {questionTypeLabels[message.questionType]}
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap leading-7 text-[#172126]">
        {message.content}
      </p>
    </article>
  );
}
