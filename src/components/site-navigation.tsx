"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { UserRole } from "@prisma/client";
import { ArrowUpRight, BookOpen, BookOpenCheck, ChartNoAxesCombined, ChevronRight, ClipboardCheck, FileText, FolderOpen, LayoutDashboard, Menu, Plus, Settings2, ShieldCheck, Users, X, type LucideIcon } from "lucide-react";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";

interface NavigationUser { name: string; role: UserRole }
interface NavigationItem { href: string; label: string; icon: LucideIcon }

function itemsFor(role: UserRole): NavigationItem[] {
  if (role === "TEACHER") return [
    { href: "/teacher", label: "教学总览", icon: LayoutDashboard },
    { href: "/teacher/courses", label: "课程资源", icon: BookOpen },
    { href: "/teacher/classes", label: "班级管理", icon: Users },
    { href: "/teacher/assignments", label: "教学任务", icon: ClipboardCheck },
    { href: "/teacher/knowledge", label: "知识审核", icon: ShieldCheck },
  ];
  if (role === "ADMIN") return [
    { href: "/admin", label: "管理总览", icon: LayoutDashboard },
    { href: "/admin/users", label: "用户管理", icon: Users },
    { href: "/admin/ai", label: "模型用量", icon: ChartNoAxesCombined },
    { href: "/admin/materials", label: "材料任务", icon: FolderOpen },
    { href: "/admin/audit", label: "审计记录", icon: ClipboardCheck },
    { href: "/teacher/knowledge", label: "知识审核", icon: ShieldCheck },
    { href: "/admin/system", label: "系统状态", icon: Settings2 },
  ];
  return [
    { href: "/dashboard", label: "学习总览", icon: LayoutDashboard },
    { href: "/learn/new", label: "自主研习", icon: Plus },
    { href: "/assignments", label: "课程任务", icon: ClipboardCheck },
    { href: "/classes", label: "学习班级", icon: Users },
    { href: "/history", label: "学习档案", icon: FolderOpen },
    { href: "/profile/learning", label: "学习分析", icon: ChartNoAxesCombined },
  ];
}

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || !["/dashboard", "/teacher", "/admin"].includes(href) && pathname.startsWith(`${href}/`);
}

export function SiteNavigation({ user }: { user: NavigationUser | null }) {
  const pathname = usePathname();
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const open = expandedPath === pathname;
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedPath(null);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    const desktop = window.matchMedia("(min-width: 961px)");
    const closeOnDesktop = () => { if (desktop.matches) setExpandedPath(null); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.removeEventListener("keydown", close);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);
  const brand = <Link href={user ? user.role === "STUDENT" ? "/dashboard" : user.role === "TEACHER" ? "/teacher" : "/admin" : "/"} className="brand" onClick={() => setExpandedPath(null)}><span className="brand-mark"><BookOpenCheck size={21} aria-hidden="true" /></span><span className="brand-copy"><strong>问思学伴</strong><small>ThinkTutor</small></span></Link>;
  if (!user) return <header className="site-header"><div className="site-header-inner">{brand}<nav aria-label="主导航" className="main-nav public-nav flex-wrap"><ThemeToggle /><Link className="nav-link workspace-help" href="/about">学习方法</Link><Link className="nav-link" href="/login">登录</Link><Link className="button button-small" href="/register">开始学习<ArrowUpRight size={15} aria-hidden="true" /></Link></nav></div></header>;

  const items = itemsFor(user.role);
  const current = items.find((item) => isCurrentPath(pathname, item.href));
  const title = current?.label ?? (pathname.startsWith("/session/") ? "研习空间" : pathname.startsWith("/report/") ? "学习报告" : pathname.startsWith("/profile") ? "个人资料" : "工作区");
  const roleName = { STUDENT: "学生工作区", TEACHER: "教师工作区", ADMIN: "管理工作区" }[user.role];
  return <header className="workspace-shell">
    <div className="workspace-topbar flex-wrap">
      <div className="workspace-brand-group shrink-0">{brand}<span className="workspace-role">{roleName}</span></div>
      <div className="workspace-account ml-auto">
        <ThemeToggle />
        <Link className="icon-button workspace-help" href="/about" aria-label="学习方法" title="学习方法"><FileText size={18} aria-hidden="true" /></Link>
        <Link href="/profile" className="workspace-profile" aria-label="个人资料" title={`${user.name} · 个人资料与安全`} aria-current={pathname === "/profile" ? "page" : undefined} onClick={() => setExpandedPath(null)}><span className="profile-initial" aria-hidden="true">{user.name.slice(0, 1)}</span><span className="profile-name">{user.name}</span></Link>
        <LogoutButton />
        <button type="button" ref={menuButton} className="icon-button navigation-toggle" aria-label={open ? "关闭主导航" : "打开主导航"} title={open ? "关闭主导航" : "打开主导航"} aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setExpandedPath(open ? null : pathname)}>{open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}</button>
      </div>
    </div>
    <div className="workspace-location"><span>{roleName}</span><ChevronRight size={13} aria-hidden="true" /><span>{title}</span></div>
    <div id="workspace-navigation" className="workspace-navigation" data-open={open}>
      <nav aria-label="主导航" className="workspace-links">{items.map(({ icon: Icon, ...item }) => <Link key={item.href} href={item.href} className="workspace-link" aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined} onClick={() => setExpandedPath(null)}><Icon size={17} aria-hidden="true" /><span>{item.label}</span></Link>)}</nav>
    </div>
  </header>;
}
