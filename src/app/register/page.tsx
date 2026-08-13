import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

export default async function RegisterPage() { if (await getCurrentUser()) redirect("/dashboard"); return <main className="auth-page"><h1>创建学生账号</h1><p>注册后即可开始自主学习并加入教师班级。</p><AuthForm mode="register" /></main>; }
