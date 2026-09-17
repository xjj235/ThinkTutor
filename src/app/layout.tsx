import type { Metadata } from "next";
import "./globals.css";
import "./tokens.css";
import "./workspace.css";
import "katex/dist/katex.min.css";
import { SiteHeader } from "@/components/site-header";
import { getServerEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "问思学伴 ThinkTutor",
  description: "基于苏格拉底提问法和费曼学习法的 AI 自主学习教练。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const env = getServerEnv();
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Static first-party code applies the saved appearance before first paint. */}
        <script id="thinktutor-theme-init" dangerouslySetInnerHTML={{ __html: 'try{document.documentElement.dataset.theme=localStorage.getItem("thinktutor-theme")==="dark"?"dark":"light"}catch{}' }} />
      </head>
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <SiteHeader />
        {env.DEPLOYMENT_ENV === "competition" ? (
          <aside className="public-status" aria-label="比赛体验说明">
            赛道二 · 教育智能体体验版。{env.AI_PROVIDER === "deepseek" ? "已接入真实 AI。" : "当前为模拟 AI，仅用于流程测试。"}
            {env.ALLOW_DRAFT_KNOWLEDGE ? "知识库含待审核示例，仅供比赛体验。" : null}
            请使用测试资料体验；AI 反馈用于辅助学习。
          </aside>
        ) : null}
        {children}
        <footer className="site-footer"><div><span>© 2026 问思学伴 ThinkTutor</span><nav aria-label="页脚导航"><a href="/about">关于</a><a href="/privacy">隐私政策</a><a href="/terms">用户协议</a></nav></div></footer>
      </body>
    </html>
  );
}
