"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { WorkspaceState } from "@/components/workspace-state";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="session-state">
      <WorkspaceState
        variant="error"
        title="页面暂时无法显示"
        description="本次页面加载未完成，请重试或返回学习总览。"
        actions={
          <>
            <button type="button" className="button" onClick={reset}>
              <RotateCcw size={16} aria-hidden="true" />
              重新尝试
            </button>
            <Link href="/dashboard" className="button button-secondary">
              <ArrowLeft size={16} aria-hidden="true" />
              返回学习总览
            </Link>
          </>
        }
      />
    </main>
  );
}
