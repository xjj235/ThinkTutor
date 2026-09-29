import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";
import { learningEntryDestination } from "@/lib/auth/learning-entry";

const previewEmails = new Set(["student@example.test", "teacher@example.test", "admin@example.test"]);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ email?: string; passwordChanged?: string; next?: string }> }) {
  const query = await searchParams;
  const next = learningEntryDestination(query.next);
  const currentUser = await getCurrentUser();
  if (currentUser) {
    redirect(currentUser.role === "TEACHER" ? "/teacher" : currentUser.role === "ADMIN" ? "/admin" : next ?? "/dashboard");
  }
  const candidate = query.email ?? "";
  const localPreview = process.env.LOCAL_PREVIEW === "true";
  const defaultEmail = localPreview && previewEmails.has(candidate) ? candidate : "";
  const defaultPassword = defaultEmail ? process.env.LOCAL_PREVIEW_PASSWORD ?? "" : "";
  return <main id="main-content" className="auth-page"><h1>登录学习空间</h1><p>{next ? "登录后，继续新建学习任务。" : "连接研习、教学与知识管理。"}</p>{query.passwordChanged === "true" ? <p className="success-panel" role="status">密码已修改，所有设备上的旧登录会话均已撤销。请使用新密码登录。</p> : null}{defaultEmail ? <p className="preview-login-note">开发预览账号 · 非生产环境</p> : null}<AuthForm mode="login" defaultEmail={defaultEmail} defaultPassword={defaultPassword} next={next} /></main>;
}
