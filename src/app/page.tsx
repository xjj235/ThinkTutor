import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";

const steps = [
  { title: "认知诊断", text: "辨识先备知识与概念边界。" },
  { title: "启发式探究", text: "通过追问建立概念、因果与证据的联系。" },
  { title: "费曼阐释", text: "以独立表达检验理解深度与迁移能力。" },
  { title: "形成性评价", text: "依据学习证据定位薄弱环节，开展定向巩固。" },
];

const dimensions = [
  ["概念完整度", "定义、特征、条件与边界"],
  ["逻辑完整度", "因果链条与推理顺序"],
  ["表达清晰度", "自己的语言与明确表达"],
  ["举例能力", "例子与概念的准确对应"],
  ["迁移能力", "将知识应用到新情境"],
];

const roles = [
  { label: "学生", title: "主动构建理解", text: "从自主任务或教师任务进入学习，保留历史、报告和针对性再练。", action: "进入学生端" },
  { label: "教师", title: "围绕目标组织教学", text: "维护课程、章节、材料和班级，以真实学习证据查看学生进展。", action: "进入教师端" },
  { label: "管理员", title: "守住系统边界", text: "管理账号与角色，检查 AI、材料任务、系统健康和关键操作审计。", action: "进入管理端" },
];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ accountDeleted?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "TEACHER" ? "/teacher" : user.role === "ADMIN" ? "/admin" : "/dashboard");
  const localPreview = process.env.LOCAL_PREVIEW === "true";
  const previewPassword = process.env.LOCAL_PREVIEW_PASSWORD ?? "ThinkTutor-Preview-2026!";
  const accountDeleted = (await searchParams).accountDeleted === "true";

  return (
    <main id="main-content" className="home-page">
      {accountDeleted ? <section className="public-status" role="status">账号和关联的个人数据已删除，你已经安全退出。</section> : null}
      {localPreview ? (
        <section className="preview-banner" aria-labelledby="preview-title" data-ai-provider={getServerEnv().AI_PROVIDER}>
          <div><span className="preview-status" aria-hidden="true" /><div><strong id="preview-title">本地预览模式</strong><p>{getServerEnv().AI_PROVIDER === "deepseek" ? "DeepSeek 真实模型已启用，调用将消耗 API 额度。" : "Mock AI 与本地数据已启用，不产生模型费用。"}</p></div></div>
          <a href="#preview-access">查看演示账号</a>
        </section>
      ) : null}

      <section className="home-hero public-hero" aria-labelledby="home-title">
        <Image className="public-hero-image" src="/images/thinktutor-learning-map.png" alt="学习者在纸面上整理知识卡片之间的关系" fill priority sizes="100vw" />
        <div className="hero-copy">
          <h1 id="home-title">问思学伴</h1>
          <p className="hero-lead">以问题深化认知，以表达检验理解。<br />让每一次研习，都有据可循。</p>
          <div className="hero-actions"><Link className="button" href="/register">创建学生账号<ArrowUpRight size={16} aria-hidden="true" /></Link><Link className="text-link" href="/login">登录已有账号<ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        </div>
      </section>

      <section className="method-section" aria-labelledby="method-title">
        <div className="method-intro"><h2 id="method-title">从认知诊断，到知识迁移</h2><p>自主建构、独立阐释与证据反馈，构成完整的学习闭环。</p></div>
        <ol className="method-track">{steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>
      </section>

      <section className="evidence-section" aria-labelledby="evidence-title">
        <div className="evidence-copy"><h2 id="evidence-title">理解的深度，<br />由学习证据呈现。</h2><p>五维评价依据本次研习中的实际表达，区分已展示的能力与尚待验证的理解。</p></div>
        <div className="dimension-list" aria-label="报告五维结构">{dimensions.map(([title, text]) => <div key={title}><strong>{title}</strong><span>{text}</span></div>)}</div>
      </section>

      <section className="roles-section" aria-labelledby="role-title">
        <div className="section-heading"><h2 id="role-title">协同育人，各有侧重</h2><p>学生主动探究，教师引领目标，平台保障学习过程。</p></div>
        <div className="role-ledger">{roles.map((role) => <article key={role.label}><span>{role.label}</span><div><h3>{role.title}</h3><p>{role.text}</p></div><Link href="/login">{role.action}<span aria-hidden="true"> →</span></Link></article>)}</div>
      </section>

      <section className="home-cta" aria-labelledby="cta-title"><div><h2 id="cta-title">开启一次有深度的研习</h2><p>确立主题，呈现理解，循证进阶。</p></div><Link className="button" href="/register">开始第一轮学习<ArrowUpRight size={16} aria-hidden="true" /></Link></section>

      {localPreview ? (
        <section id="preview-access" className="preview-access" aria-label="本地预览工具"><details><summary><span><strong>本地演示账号</strong><small>仅供开发验收，生产环境不会显示</small></span><span aria-hidden="true">展开</span></summary><div className="preview-access-content"><p>三个角色使用同一密码 <code>{previewPassword}</code>。</p><div className="preview-role-links">{[["学生", "student@example.test"], ["教师", "teacher@example.test"], ["管理员", "admin@example.test"]].map(([role, email]) => <Link className="preview-role-link" key={role} href={`/login?email=${encodeURIComponent(email)}`}><span><strong>{role}</strong><small>{email}</small></span><span aria-hidden="true">登录 →</span></Link>)}</div></div></details></section>
      ) : null}
    </main>
  );
}
