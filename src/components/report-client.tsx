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
import { ArrowLeft, RotateCcw } from "lucide-react";

type ReportPayload = {
  session: LearningSessionDTO;
  report: LearningReportDTO;
  messages?: import("@/lib/contracts").MessageDTO[];
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
          <ArrowLeft size={15} aria-hidden="true" />返回研习记录
        </Link>
        <button
          type="button"
          onClick={retrySession}
          disabled={pending || report.gaps.length === 0}
          className="w-full rounded-md bg-[#0f766e] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-[#94b8b4] sm:w-auto"
        >
          <RotateCcw size={15} aria-hidden="true" />{pending ? "正在创建..." : report.gaps.length === 0 ? "暂无待巩固要点" : "开启定向巩固"}
        </button>
      </div>

      <section className="report-summary rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-5">
        <p className="text-sm text-[#5d6b70]">形成性学习报告</p>
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
        {pending ? "正在创建定向巩固任务..." : ""}
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
        <h2 className="text-xl font-semibold text-[#172126]">五维能力评估</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {dimensionKeys.map((key) => (
            <DimensionCard key={key} report={report} dimensionKey={key} messages={payload.messages ?? []} />
          ))}
        </div>
      </section>

      <section className="report-findings grid gap-4 md:grid-cols-3">
        <StrengthBlock items={report.strengths} />
        <GapBlock items={report.gaps} />
        <ListBlock title="进阶建议" items={report.nextSteps} />
      </section>

      {report.evidenceAudit ? <section className="space-y-3 border-t border-[#dce7e6] pt-4">
        <h2 className="text-xl font-semibold">判断与版本记录</h2>
        <p className="text-sm">{report.evidenceAudit.needsTeacherReview ? "存在待教师复核的判断" : "本次证据校验已完成"}</p>
        <p className="break-all text-sm text-[#5d6b70]">知识版本：{report.sessionVersions?.releaseId}；评分版本：{report.sessionVersions?.rubricVersion}</p>
        {Object.values({ ...report.evidenceAudit.misconceptionStates, ...report.evidenceAudit.gapStates }).map((claim) => <details key={claim.claimId} className="border-t border-[#dce7e6] py-2">
          <summary className="cursor-pointer break-words py-2">{claim.claimId}：{({ CANDIDATE: "待核验", CONFIRMED: "已确认", RESOLVED: "已纠正", UNRESOLVED: "未解决" })[claim.status]}</summary>
          {claim.evidenceRefs.map((ref, i) => <blockquote key={`${ref.messageId}-${i}`} className="my-2 break-words pl-3 text-sm">{ref.extractedText}</blockquote>)}
        </details>)}
        <details><summary className="cursor-pointer py-2">阶段变更依据</summary><ol className="space-y-3">
          {report.evidenceAudit.stageTransitions.map((transition, i) => <li key={i} className="border-t py-2 text-sm">
            <p>{({ GOAL_PRESENTED: "呈现研习目标", GOAL_CONFIRMED: "确认研习目标", DIAGNOSIS_STABLE: "诊断证据稳定", CONSTRUCTION_CRITERIA_MET: "知识建构达标", CASE_PASSED: "案例迁移通过", CASE_REPAIR_REQUIRED: "案例证据待修复", FEYNMAN_MAJOR_BACKTRACK: "关键错误触发回溯", FEYNMAN_COMPLETED: "独立阐释完成", REFLECTION_COMPLETED: "反思修订完成", EXPERIENCE_LIMIT: "达到本次练习上限", SESSION_RESUMED: "启动恢复核验", RESUMED_REVERIFIED: "恢复核验通过", RESUME_GAP_IDENTIFIED: "恢复核验发现缺口" })[transition.reasonCode]}</p>
            <time className="text-[#435257]">{transition.createdAt}</time>
            {transition.evidenceRefs.slice(0, 1).map((ref) => <blockquote key={ref.messageId} className="break-words">{ref.extractedText}</blockquote>)}
          </li>)}
        </ol></details>
      </section> : null}

      <p className="rounded-md border border-[#dce7e6] bg-white p-4 text-sm leading-6 text-[#5d6b70]">
        {report.disclaimer}
      </p>
    </main>
  );
}

function DimensionCard({
  report,
  dimensionKey,
  messages,
}: {
  report: LearningReportDTO;
  dimensionKey: DimensionKey;
  messages: import("@/lib/contracts").MessageDTO[];
}) {
  const dimension = report.dimensions[dimensionKey];
  return (
    <article className="dimension-card rounded-md border border-[#dce7e6] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[#213236]">
          {dimensionLabels[dimensionKey]}
        </h3>
        <span className="text-lg font-semibold text-[#0f766e]">
          {report.evidenceAudit ? `${dimension.score / 5} / 20` : dimension.score}
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
      {report.evidenceLinks?.[dimensionKey]?.length ? <details className="mt-3 border-t border-[#dce7e6] pt-2">
        <summary className="cursor-pointer py-2 text-sm font-medium text-[#115e59]">查看评分原文</summary>
        {report.evidenceLinks[dimensionKey].map((id) => <blockquote key={id} className="my-2 break-words text-sm leading-6">{messages.find((message) => message.id === id)?.content ?? "原文暂不可用，请返回学习会话查看。"}</blockquote>)}
      </details> : null}
    </article>
  );
}
function StrengthBlock({ items }: { items: LearningReportDTO["strengths"] }) {
  return (
    <section className="report-list-block rounded-md border border-[#dce7e6] bg-white p-4">
      <h2 className="font-semibold text-[#213236]">已掌握内容</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[#5d6b70]">本次对话暂无足够证据。</p>
      ) : (
        <ol className="mt-3 space-y-4">
          {items.map((item, index) => (
            <li
              key={`${item.title}-${index}`}
              className="border-t border-[#dce7e6] pt-3 first:border-t-0 first:pt-0"
            >
              <h3 className="text-sm font-semibold text-[#213236]">
                {item.title}
              </h3>
              <p className="mt-2 break-words text-sm leading-6 text-[#435257]">
                <span className="font-medium text-[#213236]">证据：</span>
                {item.evidence}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
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
      <h2 className="font-semibold text-[#213236]">待巩固要点</h2>
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
                <span className="font-medium text-[#213236]">巩固任务：</span>
                {gap.repairTask}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
