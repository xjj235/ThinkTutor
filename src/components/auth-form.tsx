"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AsyncFeedback, idleFeedback, type AsyncFeedbackState } from "./async-feedback";
import { feedbackForError, readApiResponse } from "@/lib/client-api";

type AuthMode = "login" | "register";
type AuthBody = { name?: string; email: string; password: string };

export function AuthForm({ mode, defaultEmail = "", defaultPassword = "" }: { mode: AuthMode; defaultEmail?: string; defaultPassword?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<AsyncFeedbackState>(idleFeedback);
  const [lastBody, setLastBody] = useState<AuthBody | null>(null);
  async function execute(body: AuthBody) {
    setPending(true); setFeedback({ kind: "loading", message: mode === "login" ? "正在验证账号…" : "正在创建账号…" });
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await readApiResponse<{ role: "STUDENT" | "TEACHER" | "ADMIN" }>(response, "请求失败，请重试。");
      router.push(result.role === "TEACHER" ? "/teacher" : result.role === "ADMIN" ? "/admin" : "/dashboard"); router.refresh();
    } catch (error) { setFeedback(feedbackForError(error, "网络连接失败，请重试。")); } finally { setPending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { ...(mode === "register" ? { name: String(form.get("name") ?? "") } : {}), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") };
    setLastBody(body); await execute(body);
  }
  return <form className="auth-form" onSubmit={submit} aria-busy={pending}>{mode === "register" ? <label>姓名<input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label> : null}<label>邮箱<input name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} /></label><label>密码<input name="password" type="password" required minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} defaultValue={defaultPassword} /></label><AsyncFeedback state={feedback} onRetry={lastBody&&!pending?()=>void execute(lastBody):undefined}/><button className="button" disabled={pending}>{pending ? "处理中…" : mode === "login" ? "登录" : "创建学生账号"}</button><p className="form-note">{mode === "login" ? <>还没有账号？<Link href="/register">注册</Link></> : <>已有账号？<Link href="/login">登录</Link></>}</p></form>;
}
