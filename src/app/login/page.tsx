import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

const previewEmails = new Set(["student@example.test", "teacher@example.test", "admin@example.test"]);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ email?: string; passwordChanged?: string }> }) {
  const currentUser = await getCurrentUser();
  if (currentUser) {
    redirect(currentUser.role === "TEACHER" ? "/teacher" : currentUser.role === "ADMIN" ? "/admin" : "/dashboard");
  }
  const query = await searchParams;
  const candidate = query.email ?? "";
  const localPreview = process.env.LOCAL_PREVIEW === "true";
  const defaultEmail = localPreview && previewEmails.has(candidate) ? candidate : "";
  const defaultPassword = defaultEmail ? process.env.LOCAL_PREVIEW_PASSWORD ?? "" : "";
  return <main className="auth-page"><h1>登录 ThinkTutor</h1><p>继续你的学习、教学或系统管理工作。</p>{query.passwordChanged === "true" ? <p className="success-panel" role="status">密码已修改，所有设备上的旧登录会话均已撤销。请使用新密码登录。</p> : null}{defaultEmail ? <p className="preview-login-note">本地预览账号已填入，直接点击登录即可。</p> : null}<AuthForm mode="login" defaultEmail={defaultEmail} defaultPassword={defaultPassword} /></main>;
}
