"use client";

import { useEffect, useState } from "react";

export function LearningPending({ message, submittedContent }: { message: string; submittedContent: string }) {
  const [startedAt] = useState(() => Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const status = elapsedSeconds >= 60
    ? "仍未收到本次操作结果。请勿重复提交；若返回错误，可按页面提示重试或同步进度。"
    : elapsedSeconds >= 20
      ? "本次等待较久。请保持页面打开，收到成功结果前，本页不会清空你的内容。"
      : "正在等待服务端返回结果，本次操作期间无需重复提交。";

  return (
    <section className="learning-pending" aria-label="本次操作状态" data-testid="learning-pending">
      <div className="learning-pending-heading">
        <p role="status">{message}</p>
        <p className="learning-pending-time" aria-live="off">已等待 {elapsedSeconds} 秒</p>
      </div>
      <p className="learning-pending-description" aria-live="polite">{status}</p>
      {submittedContent ? (
        <details className="learning-pending-draft">
          <summary>查看并复制本次提交内容</summary>
          <textarea aria-label="本次提交内容（可复制）" readOnly value={submittedContent} rows={4} />
        </details>
      ) : null}
    </section>
  );
}
