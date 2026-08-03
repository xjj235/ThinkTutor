"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ApiResponse,
  DimensionKey,
  LearningReportDTO,
  LearningSessionDTO,
  SessionPayload,
  dimensionKeys,
  dimensionLabels,
} from "@/lib/contracts";

type ReportPayload = {
  session: LearningSessionDTO;
  report: LearningReportDTO;
};

async function fetchReportPayload(sessionId: string) {
  const response = await fetch(`/api/reports/${sessionId}`, {
    cache: "no-store",
  });
  const result = (await response.json()) as ApiResponse<ReportPayload>;
  if (!result.ok) {
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
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientRequestId: `retry-${Date.now()}` }),
      });
      const result = (await response.json()) as ApiResponse<SessionPayload>;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.push(`/session/${result.data.session.id}`);
    } catch {
      setError("创建再练会话失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <p aria-live="polite" className="text-[#5d6b70]">
          正在读取学习报告...
        </p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
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
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={`/session/${session.id}`} className="text-sm text-[#115e59]">
          返回学习会话
        </Link>
        <button
          type="button"
          onClick={retrySession}
          disabled={pending}
          className="rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#94b8b4]"
        >
          {pending ? "正在创建..." : "针对最大漏洞再练一轮"}
        </button>
      </div>

      <section className="rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-5">
        <p className="text-sm text-[#5d6b70]">学习报告</p>
        <h1 className="mt-1 text-3xl font-semibold text-[#172126]">
          {session.topic}
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-[#435257]">
          {session.goal}
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm text-[#5d6b70]">综合分</p>
            <p className="text-5xl font-semibold text-[#0f766e]">
              {report.scores.overallScore}
            </p>
          </div>
          <p className="max-w-3xl leading-7 text-[#213236]">
            {report.summary}
          </p>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-md bg-[#fff7f5] p-3 text-[#b42318]">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-[#172126]">五维诊断</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {dimensionKeys.map((key) => (
            <DimensionCard key={key} report={report} dimensionKey={key} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <ListBlock title="已掌握内容" items={report.mastered} />
        <ListBlock title="知识漏洞" items={report.gaps} />
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
    <article className="rounded-md border border-[#dce7e6] bg-white p-4">
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
    <section className="rounded-md border border-[#dce7e6] bg-white p-4">
      <h2 className="font-semibold text-[#213236]">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[#5d6b70]">暂无记录。</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#435257]">
          {items.map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
