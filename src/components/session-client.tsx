"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ApiResponse,
  LearningPhase,
  MessageDTO,
  MIN_ANSWER_LENGTH,
  MIN_FEYNMAN_EXPLANATION_LENGTH,
  SessionPayload,
  phaseLabels,
  questionTypeLabels,
  isApiFailure,
} from "@/lib/contracts";
import { PhaseProgress } from "./phase-progress";
import { SafeMarkdown } from "./safe-markdown";

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
  if (isApiFailure(result)) {
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
  const [pendingMessage, setPendingMessage] = useState("");
  const [error, setError] = useState("");
  const [retryAction, setRetryAction] = useState<
    "load" | "answer" | "hint" | "enterFeynman" | "feynman" | null
  >(null);
  const answerRequestId = useRef<string | null>(null);
  const hintRequestId = useRef<string | null>(null);
  const feynmanRequestId = useRef<string | null>(null);
  const enterFeynmanRequestId = useRef<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    setRetryAction(null);
    try {
      setPayload(await fetchSessionPayload(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取会话失败，请重试。");
      setRetryAction("load");
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
          setRetryAction("load");
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

  async function sendAnswer() {
    if (!payload || !answer.trim() || pending) {
      return;
    }

    setPending(true);
    setPendingMessage("正在生成下一步问题...");
    setError("");
    setRetryAction(null);
    const clientRequestId =
      answerRequestId.current ?? makeRequestId("answer");
    answerRequestId.current = clientRequestId;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answer,
          clientRequestId,
        }),
      });
      const result = (await response.json()) as ApiResponse<
        SessionPayload & { duplicate: boolean }
      >;
      if (isApiFailure(result)) {
        setError(result.error.message);
        setRetryAction(result.error.retryable ? "answer" : "load");
        return;
      }
      setPayload(result.data);
      setAnswer("");
      answerRequestId.current = null;
    } catch {
      setError("提交失败，请重试。");
      setRetryAction("answer");
    } finally {
      setPending(false);
      setPendingMessage("");
    }
  }

  function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendAnswer();
  }

  async function requestHint() {
    if (!payload || pending) {
      return;
    }

    setPending(true);
    setPendingMessage("正在生成提示...");
    setError("");
    setRetryAction(null);
    const clientRequestId = hintRequestId.current ?? makeRequestId("hint");
    hintRequestId.current = clientRequestId;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/hint`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientRequestId }),
      });
      const result = (await response.json()) as ApiResponse<
        SessionPayload & { duplicate: boolean }
      >;
      if (isApiFailure(result)) {
        setError(result.error.message);
        setRetryAction(result.error.retryable ? "hint" : "load");
        return;
      }
      setPayload(result.data);
      hintRequestId.current = null;
    } catch {
      setError("提示生成失败，请重试。");
      setRetryAction("hint");
    } finally {
      setPending(false);
      setPendingMessage("");
    }
  }

  async function sendFeynman() {
    if (
      !payload ||
      explanation.trim().length < MIN_FEYNMAN_EXPLANATION_LENGTH ||
      pending
    ) {
      return;
    }

    setPending(true);
    setPendingMessage("正在生成五维学习报告...");
    setError("");
    setRetryAction(null);
    const clientRequestId =
      feynmanRequestId.current ?? makeRequestId("feynman");
    feynmanRequestId.current = clientRequestId;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/feynman`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          explanation,
          clientRequestId,
        }),
      });
      const result = (await response.json()) as ApiResponse<{
        payload: SessionPayload;
      }>;
      if (isApiFailure(result)) {
        setError(result.error.message);
        setRetryAction(result.error.retryable ? "feynman" : "load");
        return;
      }
      feynmanRequestId.current = null;
      router.push(`/report/${sessionId}`);
    } catch {
      setError("费曼讲解提交失败，请重试。");
      setRetryAction("feynman");
    } finally {
      setPending(false);
      setPendingMessage("");
    }
  }

  async function enterFeynman() {
    if (!payload || pending) {
      return;
    }

    setPending(true);
    setPendingMessage("正在进入费曼讲解...");
    setError("");
    setRetryAction(null);
    const clientRequestId =
      enterFeynmanRequestId.current ?? makeRequestId("enter-feynman");
    enterFeynmanRequestId.current = clientRequestId;
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/feynman/enter`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientRequestId }),
        },
      );
      const result = (await response.json()) as ApiResponse<
        SessionPayload & { duplicate: boolean }
      >;
      if (isApiFailure(result)) {
        setError(result.error.message);
        setRetryAction(result.error.retryable ? "enterFeynman" : "load");
        return;
      }
      setPayload(result.data);
      enterFeynmanRequestId.current = null;
    } catch {
      setError("进入费曼讲解失败，请重试。");
      setRetryAction("enterFeynman");
    } finally {
      setPending(false);
      setPendingMessage("");
    }
  }

  function submitFeynman(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendFeynman();
  }

  function retryLastAction() {
    if (retryAction === "answer") {
      void sendAnswer();
    } else if (retryAction === "hint") {
      void requestHint();
    } else if (retryAction === "enterFeynman") {
      void enterFeynman();
    } else if (retryAction === "feynman") {
      void sendFeynman();
    } else {
      void loadSession();
    }
  }

  if (loading) {
    return (
      <main id="main-content" className="session-state">
        <p aria-live="polite" className="text-[#5d6b70]">
          正在读取学习会话...
        </p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main id="main-content" className="session-state">
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
  const canEnterFeynman =
    session.phase === "SOCRATIC" && session.socraticTurns >= 3;

  return (
    <main
      id="main-content"
      className="learning-workspace mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[320px_1fr]"
      data-parent-session-id={session.parentSessionId ?? ""}
    >
      <aside className="learning-context space-y-5 rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-4 lg:sticky lg:top-24 lg:self-start">
        <Link href="/" className="text-sm font-medium text-[#115e59]">
          返回首页
        </Link>
        <div>
          <p className="text-sm text-[#5d6b70]">当前任务</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#172126]">
            {session.topic}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#435257]">
            {session.objective}
          </p>
        </div>
        <div className="learning-details">
          <dl className="grid gap-3 text-sm">
            <Info label="学习者水平" value={session.learnerLevel} />
            <Info label="课程" value={session.course ?? "未填写"} />
            <Info label="章节" value={session.chapter ?? "未填写"} />
            <Info label="关联原会话" value={session.parentSessionId ? "已关联" : "无"} />
          </dl>
          <PhaseProgress phase={session.phase} socraticTurns={session.socraticTurns} maxTurns={session.maxTurns} />
        </div>
      </aside>

      <section className="learning-main space-y-5">
        <div className="learning-record rounded-md border border-[#dce7e6] bg-white">
          <div className="learning-record-heading border-b border-[#dce7e6] px-4 py-3">
            <h2 className="font-semibold text-[#172126]">学习对话</h2>
            <p className="mt-1 text-sm text-[#5d6b70]">
              {phaseLabels[session.phase]}阶段，系统每次只推进一个问题。
            </p>
          </div>
          <div className="learning-entries space-y-4 px-4 py-4">
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
          {pending ? pendingMessage : ""}
        </div>

        {error ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-[#f3b7ae] bg-[#fff7f5] p-4 text-sm text-[#8f1f13] sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={retryLastAction}
              disabled={pending}
              className="rounded-md border border-[#d69a92] px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retryAction && retryAction !== "load"
                ? "重试本次操作"
                : "刷新会话"}
            </button>
          </div>
        ) : null}

        {canAnswer ? (
          <form
            onSubmit={submitAnswer}
            className="response-composer rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-4"
            aria-busy={pending}
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
              onChange={(event) => {
                setAnswer(event.target.value);
                answerRequestId.current = null;
                setError("");
                setRetryAction(null);
              }}
              rows={5}
              maxLength={2000}
              required
              disabled={pending}
              className="mt-2 w-full resize-y rounded-md border border-[#c9d9d7] bg-white px-3 py-2"
              placeholder="先写出你的理解，不需要一次答完。"
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[#5d6b70]">
                {answer.length} / 2000，至少 {MIN_ANSWER_LENGTH} 字
              </span>
              <div className="flex flex-wrap gap-2">
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
                  disabled={answer.trim().length < MIN_ANSWER_LENGTH || pending}
                  className="rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#94b8b4]"
                >
                  提交回答
                </button>
              </div>
            </div>
            {canEnterFeynman ? (
              <div className="mt-4 rounded-md border border-[#b9d8d4] bg-white p-3 text-sm text-[#435257]">
                <p>你已完成至少三轮追问，可以继续回答，也可以主动检验自己的独立讲解。</p>
                <button
                  type="button"
                  onClick={enterFeynman}
                  disabled={pending}
                  className="mt-3 rounded-md border border-[#0f766e] px-4 py-2 font-medium text-[#115e59] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  进入费曼讲解
                </button>
              </div>
            ) : null}
          </form>
        ) : null}

        {canFeynman ? (
          <form
            onSubmit={submitFeynman}
            className="feynman-composer rounded-md border border-[#b9d8d4] bg-[#eef8f6] p-4"
            aria-busy={pending}
          >
            <label
              htmlFor="feynman"
              className="block text-sm font-medium text-[#213236]"
            >
              费曼讲解
            </label>
            <div
              id="feynman-requirements"
              className="mt-2 rounded-md border border-[#cfe3e0] bg-white p-3 text-sm leading-6 text-[#435257]"
            >
              <p className="font-medium text-[#213236]">提交前请确保讲解包含：</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>核心概念及其边界</li>
                <li>条件、原因和结果之间的联系</li>
                <li>至少一个具体例子</li>
                <li>换到新场景时需要检查的条件</li>
              </ul>
            </div>
            <textarea
              id="feynman"
              value={explanation}
              onChange={(event) => {
                setExplanation(event.target.value);
                feynmanRequestId.current = null;
                setError("");
                setRetryAction(null);
              }}
              rows={8}
              maxLength={4000}
              required
              disabled={pending}
              aria-describedby="feynman-requirements"
              className="mt-3 w-full resize-y rounded-md border border-[#b9d8d4] bg-white px-3 py-2"
              placeholder="用自己的话讲给初学者听，包含概念、因果、例子和迁移场景。"
            />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-[#5d6b70]">
                {explanation.length} / 4000，至少 {MIN_FEYNMAN_EXPLANATION_LENGTH} 字
              </span>
              <button
                type="submit"
                disabled={
                  explanation.trim().length <
                    MIN_FEYNMAN_EXPLANATION_LENGTH || pending
                }
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
  const author =
    message.role === "ASSISTANT"
      ? "问思学伴"
      : message.role === "SYSTEM"
        ? "学习进度"
        : "学生";
  const phase = phaseLabels[message.phase as LearningPhase];

  return (
    <article
      className={[
        "learning-entry rounded-md border p-4",
        assistant
          ? "learning-entry-assistant border-[#dce7e6] bg-[#f7fbfa]"
          : message.role === "SYSTEM"
            ? "learning-entry-system border-[#dce7e6] bg-white"
            : "learning-entry-student border-[#c8d8e0] bg-white",
      ].join(" ")}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[#5d6b70]">
        <span className="font-semibold text-[#213236]">
          {author}
        </span>
        <span>{phase}</span>
        {message.questionType ? (
          <span className="rounded-full border border-[#b9d8d4] px-2 py-0.5">
            {questionTypeLabels[message.questionType]}
          </span>
        ) : null}
      </div>
      <SafeMarkdown>{message.content}</SafeMarkdown>
    </article>
  );
}
