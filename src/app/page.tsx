import Link from "next/link";
import { redirect } from "next/navigation";
import { LearningEntry } from "@/components/learning-entry";
import { getCurrentUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ accountDeleted?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "TEACHER" ? "/teacher" : user.role === "ADMIN" ? "/admin" : "/dashboard");
  const localPreview = process.env.LOCAL_PREVIEW === "true";
  const previewPassword = process.env.LOCAL_PREVIEW_PASSWORD ?? "ThinkTutor-Preview-2026!";
  const accountDeleted = (await searchParams).accountDeleted === "true";

  return (
    <main id="main-content" className="home-page">
      {accountDeleted ? <section className="public-status" role="status">账号和关联的个人数据已删除，你已经安全退出。</section> : null}
      <LearningEntry signedIn={false} />
      {localPreview ? (
        <section id="preview-access" className="preview-access" aria-label="本地预览工具" data-ai-provider={getServerEnv().AI_PROVIDER}>
          <details>
            <summary><span><strong>本地演示账号</strong><small>仅供开发验收，生产环境不会显示</small></span><span aria-hidden="true">展开</span></summary>
            <div className="preview-access-content">
              <p>{getServerEnv().AI_PROVIDER === "deepseek" ? "DeepSeek 真实模型已启用，调用将消耗 API 额度。" : "Mock AI 与本地数据已启用，不产生模型费用。"}</p>
              <p>三个角色使用同一密码 <code>{previewPassword}</code>。</p>
              <div className="preview-role-links">{[["学生", "student@example.test"], ["教师", "teacher@example.test"], ["管理员", "admin@example.test"]].map(([role, email]) => <Link className="preview-role-link" key={role} href={`/login?email=${encodeURIComponent(email)}`}><span><strong>{role}</strong><small>{email}</small></span><span aria-hidden="true">登录 →</span></Link>)}</div>
            </div>
          </details>
        </section>
      ) : null}
    </main>
  );
}
