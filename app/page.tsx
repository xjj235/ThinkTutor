import Link from "next/link";

const steps = [
  {
    title: "知识诊断",
    text: "先暴露已有理解和不确定处。",
  },
  {
    title: "苏格拉底追问",
    text: "连续追问概念、原因、假设和迁移。",
  },
  {
    title: "费曼讲解",
    text: "学生用自己的话完成输出。",
  },
  {
    title: "学习报告",
    text: "形成五维反馈并针对漏洞再练。",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold text-[#0f766e]">
            AI 自主学习教练
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-normal text-[#172126] sm:text-5xl">
            问思学伴 ThinkTutor
          </h1>
          <p className="mt-5 text-lg leading-8 text-[#435257]">
            基于苏格拉底提问法和费曼学习法，帮助学生完成“输入、建构、输出、反馈”的自主学习闭环。
          </p>
          <Link
            href="/task/new"
            className="mt-8 inline-flex min-h-11 items-center rounded-md bg-[#0f766e] px-5 py-2.5 font-medium text-white hover:bg-[#115e59]"
          >
            开始学习
          </Link>
        </div>

        <section className="mt-12" aria-labelledby="flow-title">
          <h2 id="flow-title" className="text-xl font-semibold text-[#172126]">
            四阶段学习流程
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-md border border-[#dce7e6] bg-[#f7fbfa] p-4"
              >
                <p className="text-sm font-semibold text-[#0f766e]">
                  阶段 {index + 1}
                </p>
                <h3 className="mt-2 font-semibold text-[#213236]">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#5d6b70]">
                  {step.text}
                </p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
