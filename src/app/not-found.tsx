import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { WorkspaceState } from "@/components/workspace-state";

export default function NotFound() {
  return (
    <main id="main-content" className="session-state">
      <WorkspaceState
        variant="not-found"
        title="未找到该页面"
        description="当前地址没有对应的页面，请从首页或学习总览继续。"
        actions={
          <>
            <Link href="/" className="button">
              <ArrowLeft size={16} aria-hidden="true" />
              返回首页
            </Link>
            <Link href="/dashboard" className="button button-secondary">
              <LayoutDashboard size={16} aria-hidden="true" />
              学习总览
            </Link>
          </>
        }
      />
    </main>
  );
}
