import Image from "next/image";
import Link from "next/link";

const steps = [
  { title: "知识诊断", text: "先说出已有理解，暴露真正需要补齐的地方。" },
  { title: "苏格拉底追问", text: "一次处理一个关键问题，自己连接概念、原因与证据。" },
  { title: "费曼讲解", text: "用自己的语言讲清概念、机制、例子和迁移条件。" },
  { title: "形成性报告", text: "从真实表达提取证据，并针对最高优先级漏洞再练。" },
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
  const localPreview = process.env.LOCAL_PREVIEW === "true";
  const previewPassword = process.env.LOCAL_PREVIEW_PASSWORD ?? "ThinkTutor-Preview-2026!";
  const accountDeleted = (await searchParams).accountDeleted === "true";

  return (
    <main id="main-content" className="home-page">
      {accountDeleted ? <section className="public-status" role="status">账号和关联的个人数据已删除，你已经安全退出。</section> : null}
      {localPreview ? (
        <section className="preview-banner" aria-labelledby="preview-title">
          <div><span className="preview-status" aria-hidden="true" /><div><strong id="preview-title">本地预览模式</strong><p>Mock AI 与本地数据已启用，不产生模型费用。</p></div></div>
          <a href="#preview-access">查看演示账号</a>
        </section>
      ) : null}

      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">从“好像懂了”<span>到真正讲清楚。</span></h1>
          <p className="hero-lead">问思学伴不替你完成答案。它用追问和讲解，让理解经过表达、检验与迁移。</p>
          <div className="hero-actions"><Link className="button" href="/register">创建学生账号</Link><Link className="text-link" href="/login">登录已有账号<span aria-hidden="true"> →</span></Link></div>
        </div>
        <figure className="hero-visual">
          <Image src="/images/thinktutor-learning-map.png" alt="学习者在纸面上整理知识卡片之间的关系" width={1536} height={1024} priority sizes="(max-width: 860px) 100vw, 50vw" />
          <figcaption><strong>学习发生在回答之前。</strong><span>先暴露理解，再建立连接。</span></figcaption>
        </figure>
      </section>

      <section className="method-section" aria-labelledby="method-title">
        <div className="method-intro"><h2 id="method-title">一条清楚的学习路径</h2><p>每一步都由服务端验证。AI 可以建议，但不能跳过学生应完成的思考。</p></div>
        <ol className="method-track">{steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol>
      </section>

      <section className="evidence-section" aria-labelledby="evidence-title">
        <div className="evidence-copy"><h2 id="evidence-title">不是黑盒分数，<br />而是可追溯的学习证据。</h2><p>报告只评价本次对话里实际展示的能力。综合分由服务端计算；没有展示，就明确写明没有展示。</p></div>
        <div className="dimension-list" aria-label="报告五维结构">{dimensions.map(([title, text]) => <div key={title}><strong>{title}</strong><span>{text}</span></div>)}</div>
      </section>

      <section className="roles-section" aria-labelledby="role-title">
        <div className="section-heading"><h2 id="role-title">同一条学习证据链，服务三个角色</h2><p>学生负责表达，教师负责目标与材料，管理员负责安全和运行边界。</p></div>
        <div className="role-ledger">{roles.map((role) => <article key={role.label}><span>{role.label}</span><div><h3>{role.title}</h3><p>{role.text}</p></div><Link href="/login">{role.action}<span aria-hidden="true"> →</span></Link></article>)}</div>
      </section>

      <section className="home-cta" aria-labelledby="cta-title"><div><h2 id="cta-title">从一次真实表达开始。</h2><p>选择一个知识点，说出你目前的理解。</p></div><Link className="button" href="/register">开始第一轮学习</Link></section>

      {localPreview ? (
        <section id="preview-access" className="preview-access" aria-label="本地预览工具"><details><summary><span><strong>本地演示账号</strong><small>仅供开发验收，生产环境不会显示</small></span><span aria-hidden="true">展开</span></summary><div className="preview-access-content"><p>三个角色使用同一密码 <code>{previewPassword}</code>。</p><div className="preview-role-links">{[["学生", "student@example.test"], ["教师", "teacher@example.test"], ["管理员", "admin@example.test"]].map(([role, email]) => <Link className="preview-role-link" key={role} href={`/login?email=${encodeURIComponent(email)}`}><span><strong>{role}</strong><small>{email}</small></span><span aria-hidden="true">登录 →</span></Link>)}</div></div></details></section>
      ) : null}
    </main>
  );
}
