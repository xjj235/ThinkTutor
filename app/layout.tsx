import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "问思学伴 ThinkTutor",
  description: "基于苏格拉底提问法和费曼学习法的 AI 自主学习教练。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
