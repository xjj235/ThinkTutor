"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncFeedback, idleFeedback, type AsyncFeedbackState } from "./async-feedback";
import { feedbackForError, readApiResponse } from "@/lib/client-api";

export function LeaveClassButton({ classroomId }: { classroomId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AsyncFeedbackState>(idleFeedback);

  async function leave() {
    if (pending) return;
    setPending(true);
    setFeedback({ kind: "loading", message: "正在退出班级…" });
    try {
      const response = await fetch(`/api/classes/${encodeURIComponent(classroomId)}/leave`, { method: "POST" });
      await readApiResponse(response, "退出班级失败，请重试。");
      router.push("/classes");
      router.refresh();
    } catch (error) {
      setFeedback(feedbackForError(error, "退出班级失败，请重试。"));
      setPending(false);
    }
  }

  return <section className="card" aria-label="班级成员管理" aria-busy={pending}>
    {confirming ? <>
      <p>退出后不再接收这个班级的任务，也无法从班级入口开始新任务。已开始的学习可以从学习历史继续；已有学习记录和报告会保留在学习档案中。班级开放时，可以使用加入码重新加入。</p>
      <div className="row-actions">
        <button type="button" className="button button-secondary" disabled={pending} onClick={() => void leave()}>{pending ? "正在退出…" : "确认退出班级"}</button>
        <button type="button" className="button button-secondary" disabled={pending} onClick={() => setConfirming(false)}>取消</button>
      </div>
    </> : <button type="button" className="button button-secondary" onClick={() => setConfirming(true)}>退出班级</button>}
    <AsyncFeedback state={feedback} />
  </section>;
}
