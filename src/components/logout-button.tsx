"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <span className="logout-control"><button type="button" disabled={pending} className="icon-button" aria-label={pending ? "退出中" : "退出"} title={pending ? "退出中" : "退出登录"} onClick={async () => {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("退出请求失败");
      router.push("/");
      router.refresh();
    } catch {
      setError("退出失败，请重试");
    } finally {
      setPending(false);
    }
  }}><LogOut size={18} aria-hidden="true" /></button>{error ? <small role="alert">{error}</small> : null}</span>;
}
