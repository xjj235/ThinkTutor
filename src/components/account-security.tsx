"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ApiResult = { error?: { message?: string } };

async function readResult(response: Response): Promise<ApiResult> {
  return await response.json() as ApiResult;
}

export function AccountSecurity() {
  const router = useRouter();
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPasswordPending(true);
    setPasswordMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/me/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(form.get("currentPassword") ?? ""),
          newPassword: String(form.get("newPassword") ?? ""),
        }),
      });
      const result = await readResult(response);
      if (!response.ok) {
        setPasswordMessage(result.error?.message ?? "密码修改失败，请重试。");
        return;
      }
      router.replace("/login?passwordChanged=true");
      router.refresh();
    } catch {
      setPasswordMessage("网络连接失败，请重试。");
    } finally {
      setPasswordPending(false);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setDeletePending(true);
    setDeleteMessage("");
    const form = new FormData(event.currentTarget);
    if (String(form.get("confirmation") ?? "").trim() !== "删除我的账号") {
      setDeleteMessage("请输入“删除我的账号”进行确认。");
      setDeletePending(false);
      return;
    }
    try {
      const response = await fetch("/api/me", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: String(form.get("deletePassword") ?? "") }),
      });
      const result = await readResult(response);
      if (!response.ok) {
        setDeleteMessage(result.error?.message ?? "账号删除失败，请重试。");
        return;
      }
      router.replace("/?accountDeleted=true");
      router.refresh();
    } catch {
      setDeleteMessage("网络连接失败，请重试。");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <section className="account-security" aria-labelledby="security-title">
      <div>
        <h2 id="security-title">账号安全</h2>
        <p>修改密码会撤销这个账号在所有设备上的登录会话，你需要使用新密码重新登录。</p>
      </div>
      <form className="stack-form card" onSubmit={changePassword}>
        <h3>修改密码并退出所有设备</h3>
        <label>当前密码<input name="currentPassword" type="password" required minLength={1} maxLength={128} autoComplete="current-password" /></label>
        <label>新密码<input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" aria-describedby="password-help" /></label>
        <small id="password-help">至少 10 个字符，同时包含字母和数字。</small>
        {passwordMessage ? <p className="form-error" role="alert">{passwordMessage}</p> : null}
        <button className="button" disabled={passwordPending}>{passwordPending ? "更新中…" : "修改密码并重新登录"}</button>
      </form>

      <form className="stack-form card danger-zone" onSubmit={deleteAccount}>
        <h3>删除账号和个人数据</h3>
        <p>该操作不可撤销。你的登录会话和个人学习数据将被删除。教师必须先转移所负责的课程、班级和任务；管理员不能在这里删除账号。</p>
        <label>输入“删除我的账号”确认<input name="confirmation" required autoComplete="off" /></label>
        <label>当前密码<input name="deletePassword" type="password" required minLength={1} maxLength={128} autoComplete="current-password" /></label>
        {deleteMessage ? <p className="form-error" role="alert">{deleteMessage}</p> : null}
        <button className="button button-danger" disabled={deletePending}>{deletePending ? "删除中…" : "永久删除账号"}</button>
      </form>
    </section>
  );
}
