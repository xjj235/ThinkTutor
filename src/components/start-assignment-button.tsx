"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AsyncFeedback, idleFeedback, type AsyncFeedbackState } from "./async-feedback";
import { feedbackForError, readApiResponse } from "@/lib/client-api";
import { makeClientRequestId } from "@/lib/client-request-id";

export function StartAssignmentButton({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const requestIdRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AsyncFeedbackState>(idleFeedback);

  async function start() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFeedback({ kind: "loading", message: "正在生成初始诊断…" });
    let navigating = false;
    try {
      requestIdRef.current ??= makeClientRequestId("assignment");
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId, topic: "由教师任务提供", objective: "由教师任务提供", learnerLevel: "由教师任务提供", clientRequestId: requestIdRef.current }),
      });
      const result = await readApiResponse<{ session: { id: string } }>(response, "启动失败，请重试。");
      router.push(`/session/${result.session.id}`);
      navigating = true;
    } catch (error) {
      setFeedback(feedbackForError(error, "启动失败，请重试。"));
    } finally {
      if (!navigating) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  return <div>
    <button className="button" disabled={pending} onClick={() => void start()}>{pending ? "正在生成诊断…" : "开始这项学习"}</button>
    <AsyncFeedback state={feedback} onRetry={!pending && feedback.kind === "error" && feedback.retryable ? () => void start() : undefined} />
  </div>;
}
