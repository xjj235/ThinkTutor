import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WorkspaceState } from "@/components/workspace-state";

export default function Loading() {
  return (
    <main id="main-content" className="session-state">
      <WorkspaceState
        variant="loading"
        title="正在加载页面"
        description="正在读取页面内容，请稍候。"
        actions={
          <Link href="/dashboard" className="button button-secondary">
            <ArrowLeft size={16} aria-hidden="true" />
            返回学习总览
          </Link>
        }
      />
    </main>
  );
}
