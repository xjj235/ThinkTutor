import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

export default async function RegisterPage() { if (await getCurrentUser()) redirect("/dashboard"); return <main id="main-content" className="auth-page"><h1>创建学生账号</h1><p>建立个人学习档案，开启自主研习。</p><AuthForm mode="register" /></main>; }
