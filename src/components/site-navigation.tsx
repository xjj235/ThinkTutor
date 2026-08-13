"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { LogoutButton } from "./logout-button";

interface NavigationUser {
  name: string;
  role: UserRole;
}

interface NavigationItem {
  href: string;
  label: string;
}

function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/teacher" || href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationLink({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const current = isCurrentPath(pathname, item.href);
  return <Link className="nav-link" href={item.href} aria-current={current ? "page" : undefined}>{item.label}</Link>;
}

function itemsFor(user: NavigationUser): NavigationItem[] {
  if (user.role === "TEACHER") return [
    { href: "/teacher", label: "工作台" },
    { href: "/teacher/courses", label: "课程" },
    { href: "/teacher/classes", label: "班级" },
    { href: "/teacher/assignments", label: "任务" },
  ];
  if (user.role === "ADMIN") return [
    { href: "/admin", label: "工作台" },
    { href: "/admin/users", label: "用户" },
    { href: "/admin/system", label: "系统" },
  ];
  return [
    { href: "/dashboard", label: "工作台" },
    { href: "/assignments", label: "学习任务" },
    { href: "/classes", label: "班级" },
    { href: "/history", label: "学习历史" },
  ];
}

export function SiteNavigation({ user }: { user: NavigationUser | null }) {
  const pathname = usePathname();

  if (!user) return <nav aria-label="主导航" className="main-nav public-nav">
    <NavigationLink item={{ href: "/about", label: "学习方法" }} pathname={pathname} />
    <NavigationLink item={{ href: "/login", label: "登录" }} pathname={pathname} />
    <Link className="button button-small" href="/register" aria-current={pathname === "/register" ? "page" : undefined}>开始学习</Link>
  </nav>;

  const items = itemsFor(user);
  return <>
    <nav aria-label="主导航" className="main-nav desktop-user-nav">
      {items.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
      <NavigationLink item={{ href: "/profile", label: user.name }} pathname={pathname} />
      <LogoutButton />
    </nav>
    <details className="mobile-nav">
      <summary aria-label="打开主导航">菜单</summary>
      <nav aria-label="移动端主导航">
        {items.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} />)}
        <NavigationLink item={{ href: "/profile", label: "个人资料" }} pathname={pathname} />
        <LogoutButton />
      </nav>
    </details>
  </>;
}
