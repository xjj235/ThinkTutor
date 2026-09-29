import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";
import { learningEntryDestination } from "@/lib/auth/learning-entry";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = learningEntryDestination((await searchParams).next);
  const user = await getCurrentUser();
  if (user) redirect(user.role === "TEACHER" ? "/teacher" : user.role === "ADMIN" ? "/admin" : next ?? "/dashboard");
  return <main id="main-content" className="auth-page"><h1>创建学生账号</h1><p>{next ? "创建账号后，继续新建学习任务。" : "建立个人学习档案，开启自主研习。"}</p><AuthForm mode="register" next={next} /></main>;
}
