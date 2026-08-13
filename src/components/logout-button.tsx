"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <span className="logout-control"><button type="button" disabled={pending} className="nav-link" onClick={async () => {
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
  }}>{pending ? "退出中" : "退出"}</button>{error ? <small role="alert">{error}</small> : null}</span>;
}
