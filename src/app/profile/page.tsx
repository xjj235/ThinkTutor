import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { ProfileForm } from "@/components/profile-form";
import { AccountSecurity } from "@/components/account-security";
import { requirePageUser } from "@/lib/page-auth";
import { userRoleLabels } from "@/lib/display-labels";
export default async function ProfilePage(){const user=await requirePageUser();return <PageShell title="个人资料与账号安全" description={`账号角色：${userRoleLabels[user.role]}。你可以在网页中更新资料、撤销所有会话或申请删除个人账号。`} actions={user.role==="STUDENT"?<Link className="text-link" href="/dashboard">返回学习首页</Link>:undefined}>{user.role === "STUDENT" ? <nav aria-label="我的学习" className="profile-learning-links"><Link href="/history">历史学习记录</Link><Link href="/profile/learning">学习分析</Link><Link href="/assignments">课程任务</Link><Link href="/classes">学习班级</Link></nav> : null}<ProfileForm name={user.name} email={user.email}/><AccountSecurity /></PageShell>}
