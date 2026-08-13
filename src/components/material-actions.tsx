"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AsyncFeedback, idleFeedback, type AsyncFeedbackState } from "./async-feedback";
import { feedbackForError, readApiResponse } from "@/lib/client-api";

type MaterialStatus = "PENDING_UPLOAD" | "UPLOADED" | "QUEUED" | "PROCESSING" | "READY" | "FAILED" | "UNSUPPORTED" | "DELETED";

export function MaterialActions({ id, title, status, allowDelete = true }: { id: string; title: string; status: MaterialStatus; allowDelete?: boolean }) {
  const router = useRouter(); const [pending, setPending] = useState<"retry" | "delete" | null>(null); const [feedback,setFeedback]=useState<AsyncFeedbackState>(idleFeedback); const [lastAction,setLastAction]=useState<"retry"|"delete"|null>(null);
  async function request(action:"retry"|"delete",confirmed=false):Promise<void>{if(action==="delete"&&!confirmed&&!window.confirm(`确认删除课程材料“${title}”吗？其检索片段也会被移除，且无法恢复。`))return;setLastAction(action);setPending(action);setFeedback({kind:"loading",message:action==="retry"?"正在重新加入处理队列…":"正在删除材料及检索片段…"});try{const response=await fetch(action==="retry"?`/api/materials/${id}/reprocess`:`/api/materials/${id}`,{method:action==="retry"?"POST":"DELETE",...(action==="retry"?{headers:{"content-type":"application/json"},body:"{}"}:{})});await readApiResponse(response,"操作失败，请重试。");setFeedback({kind:"success",message:action==="retry"?"已重新加入处理队列。":"材料和检索片段已删除。"});router.refresh()}catch(error){setFeedback(feedbackForError(error,"操作失败，请重试。"))}finally{setPending(null)}}
  const canRetry=status==="FAILED"||status==="READY";return <div className="material-actions"><div className="inline-controls">{canRetry?<button type="button" className="button button-small button-secondary" disabled={pending!==null} onClick={()=>void request("retry")}>{pending==="retry"?"提交中…":status==="FAILED"?"重试处理":"重新处理"}</button>:null}{allowDelete?<button type="button" className="button button-small button-danger-outline" disabled={pending!==null} onClick={()=>void request("delete")}>{pending==="delete"?"删除中…":"删除材料"}</button>:null}</div><AsyncFeedback state={feedback} onRetry={lastAction&&pending===null?()=>void request(lastAction,lastAction==="delete"):undefined}/></div>
}
