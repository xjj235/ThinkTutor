"use client";

import { useState } from "react";
import { AsyncFeedback, idleFeedback, type AsyncFeedbackState } from "./async-feedback";
import { feedbackForError, readApiResponse } from "@/lib/client-api";
import { userRoleLabels, userStatusLabels } from "@/lib/display-labels";

type Role = "STUDENT" | "TEACHER" | "ADMIN";
type Status = "ACTIVE" | "DISABLED" | "DELETED";

export function AdminUserActions({ id, name, role, status, isCurrentUser }: { id: string; name: string; role: Role; status: Status; isCurrentUser: boolean }) {
  const [currentRole, setCurrentRole] = useState(role);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AsyncFeedbackState>(idleFeedback);
  const [lastAction, setLastAction] = useState<{ kind: "role" | "status"; value: Role | Status } | null>(null);

  async function patch(kind: "role" | "status", value: Role | Status, confirmed = false): Promise<void> {
    const nextLabel = kind === "role" ? userRoleLabels[value as Role] : userStatusLabels[value as Status];
    const dangerous = kind === "status" && value !== "ACTIVE" || kind === "role" && value === "ADMIN";
    if (dangerous && !confirmed && !window.confirm(`确认将“${name}”的${kind === "role" ? "角色" : "状态"}改为“${nextLabel}”吗？${value === "DISABLED" || value === "DELETED" ? "该用户现有登录会话将被撤销。" : ""}`)) return;
    setLastAction({ kind, value });
    setPending(true);
    setFeedback({ kind: "loading", message: "正在保存并写入审计日志…" });
    try {
      const response = await fetch(`/api/admin/users/${id}/${kind}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [kind]: value }) });
      await readApiResponse(response, "更新失败，请重试。");
      if (kind === "role") setCurrentRole(value as Role); else setCurrentStatus(value as Status);
      setFeedback({ kind: "success", message: "用户设置已更新。" });
    } catch (error) {
      setFeedback(feedbackForError(error, "更新失败，请重试。"));
    } finally { setPending(false); }
  }

  const retry = lastAction ? () => void patch(lastAction.kind, lastAction.value) : undefined;
  return <div className="action-stack"><div className="inline-controls"><label><span className="sr-only">{name}的角色</span><select key={`role-${selectionRevision}`} aria-label={`${name}的角色`} disabled={pending || currentStatus === "DELETED"} value={currentRole} onChange={(event) => {const value=event.target.value as Role;if(value==="ADMIN"&&!window.confirm(`确认将“${name}”的角色改为“${userRoleLabels[value]}”吗？`)){setSelectionRevision((revision)=>revision+1);return}void patch("role",value,true)}}><option value="STUDENT">{userRoleLabels.STUDENT}</option><option value="TEACHER">{userRoleLabels.TEACHER}</option><option value="ADMIN">{userRoleLabels.ADMIN}</option></select></label><label><span className="sr-only">{name}的状态</span><select key={`status-${selectionRevision}`} aria-label={`${name}的状态`} disabled={pending || isCurrentUser} value={currentStatus} onChange={(event) => {const value=event.target.value as Status;if(value!=="ACTIVE"&&!window.confirm(`确认将“${name}”的状态改为“${userStatusLabels[value]}”吗？该用户现有登录会话将被撤销。`)){setSelectionRevision((revision)=>revision+1);return}void patch("status",value,true)}}><option value="ACTIVE">{userStatusLabels.ACTIVE}</option><option value="DISABLED">{userStatusLabels.DISABLED}</option><option value="DELETED">{userStatusLabels.DELETED}</option></select></label></div>{isCurrentUser ? <small>不能停用当前管理员账号。</small> : null}<AsyncFeedback state={feedback} onRetry={retry} /></div>;
}
