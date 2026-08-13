"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiResponse,
  DimensionKey,
  LearningReportDTO,
  LearningSessionDTO,
  ReportGap,
  SessionPayload,
  dimensionKeys,
  dimensionLabels,
  isApiFailure,
} from "@/lib/contracts";
import { SafeMarkdown } from "./safe-markdown";

type ReportPayload = {
  session: LearningSessionDTO;
  report: LearningReportDTO;
};

function makeRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `retry-${crypto.randomUUID()}`;
  }
  return `retry-${Date.now()}`;
}

async function fetchReportPayload(sessionId: string) {
  const response = await fetch(`/api/reports/${sessionId}`, {
    cache: "no-store",
  });
  const result = (await response.json()) as ApiResponse<ReportPayload>;
  if (isApiFailure(result)) {
    throw new Error(result.error.message);
  }
  return result.data;
}

export function ReportClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const retryRequestId = useRef<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await fetchReportPayload(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取报告失败，请重试。");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;

    void fetchReportPayload(sessionId)
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "读取报告失败，请重试。",
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

  async function retrySession() {
    if (pending) {
      return;
    }

    setPending(true);
    setError("");
    const clientRequestId = retryRequestId.current ?? makeRequestId();
    retryRequestId.current = clientRequestId;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientRequestId }),
      });
      const result = (await response.json()) as ApiResponse<SessionPayload>;
      if (isApiFailure(result)) {
        setError(result.error.message);
        return;
      }
      retryRequestId.current = null;
      router.push(`/session/${result.data.session.id}`);
    } catch {
      setError("创建再练会话失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main id="main-content" className="session-state">
        <p aria-live="polite" className="text-[#5d6b70]">
          正在读取学习报告...
        </p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main id="main-content" className="session-state">
        <p role="alert" className="text-[#b42318]">
          {error || "报告不存在。"}
        </p>
        <button
          type="button"
          onClick={loadReport}
          className="mt-4 rounded-md border border-[#b9d8d4] px-4 py-2 text-[#115e59]"
        >
          重新加载
        </button>
      </main>
    );
  }

  const { session, report } = payload;

  return (
    <main
      id="main-content"
      className="report-page mx-auto max-w-6xl space-y-6 px-4 py-6"
      aria-busy={pending}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={`/session/${session.id}`} className="text-sm text-[#115e59]">
          返回学习会话
        </Link>
        <button
          type="button"
          onClick={retrySession}
          disabled={pending}
          className="w-full rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#94b8b4] sm:w-auto"
        >
          {pending ? "正在创建..." : "针对最高优先级漏洞再练一轮"}
        </button>
      </div>

      <section className="report-summary rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-5">
        <p className="text-sm text-[#5d6b70]">学习报告</p>
        <h1 className="mt-1 text-3xl font-semibold text-[#172126]">
          {session.topic}
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-[#435257]">
          {session.objective}
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm text-[#5d6b70]">综合分</p>
            <p className="text-5xl font-semibold text-[#0f766e]">
              {report.overallScore}
            </p>
          </div>
          <div className="max-w-3xl text-[#213236]"><SafeMarkdown>{report.summary}</SafeMarkdown></div>
        </div>
      </section>

      <div aria-live="polite" className="min-h-6 text-sm text-[#5d6b70]">
        {pending ? "正在创建针对最高优先级漏洞的练习..." : ""}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border border-[#f3b7ae] bg-[#fff7f5] p-4 text-[#8f1f13] sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={retrySession}
            disabled={pending}
            className="rounded-md border border-[#d69a92] px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            重试创建
          </button>
        </div>
      ) : null}

      <section className="report-dimensions space-y-4">
        <h2 className="text-xl font-semibold text-[#172126]">五维诊断</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {dimensionKeys.map((key) => (
            <DimensionCard key={key} report={report} dimensionKey={key} />
          ))}
        </div>
      </section>

      <section className="report-findings grid gap-4 md:grid-cols-3">
        <ListBlock title="已掌握内容" items={report.strengths} />
        <GapBlock items={report.gaps} />
        <ListBlock title="下一步建议" items={report.nextSteps} />
      </section>

      <p className="rounded-md border border-[#dce7e6] bg-white p-4 text-sm leading-6 text-[#5d6b70]">
        {report.disclaimer}
      </p>
    </main>
  );
}

function DimensionCard({
  report,
  dimensionKey,
}: {
  report: LearningReportDTO;
  dimensionKey: DimensionKey;
}) {
  const dimension = report.dimensions[dimensionKey];
  return (
    <article className="dimension-card rounded-md border border-[#dce7e6] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[#213236]">
          {dimensionLabels[dimensionKey]}
        </h3>
        <span className="text-lg font-semibold text-[#0f766e]">
          {dimension.score}
        </span>
      </div>
      <div
        className="mt-3 h-3 rounded-full bg-[#e5eeed]"
        aria-label={`${dimensionLabels[dimensionKey]} ${dimension.score} 分`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={dimension.score}
      >
        <div
          className="h-3 rounded-full bg-[#0f766e]"
          style={{ width: `${dimension.score}%` }}
        />
      </div>
      <p className="mt-4 text-sm leading-6 text-[#435257]">
        <span className="font-medium text-[#213236]">证据：</span>
        {dimension.evidence}
      </p>
      <p className="mt-2 text-sm leading-6 text-[#435257]">
        <span className="font-medium text-[#213236]">反馈：</span>
        {dimension.feedback}
      </p>
    </article>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="report-list-block rounded-md border border-[#dce7e6] bg-white p-4">
      <h2 className="font-semibold text-[#213236]">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[#5d6b70]">暂无记录。</p>
      ) : (
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[#435257]">
          {items.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GapBlock({ items }: { items: ReportGap[] }) {
  const sortedItems = [...items].sort((left, right) => right.priority - left.priority);

  return (
    <section className="report-list-block report-gap-block rounded-md border border-[#dce7e6] bg-white p-4">
      <h2 className="font-semibold text-[#213236]">知识漏洞</h2>
      {sortedItems.length === 0 ? (
        <p className="mt-3 text-sm text-[#5d6b70]">暂无记录。</p>
      ) : (
        <ol className="mt-3 space-y-4">
          {sortedItems.map((gap, index) => (
            <li
              key={`${gap.title}-${gap.priority}-${index}`}
              className="border-t border-[#dce7e6] pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#213236]">
                  {gap.title}
                </h3>
                <span className="shrink-0 rounded-full border border-[#b9d8d4] bg-[#eef8f6] px-2 py-0.5 text-xs font-medium text-[#115e59]">
                  优先级 {gap.priority}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#435257]">
                <span className="font-medium text-[#213236]">依据：</span>
                {gap.evidence}
              </p>
              <p className="mt-2 text-sm leading-6 text-[#435257]">
                <span className="font-medium text-[#213236]">修复任务：</span>
                {gap.repairTask}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
