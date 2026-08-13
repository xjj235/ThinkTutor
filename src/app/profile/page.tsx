import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { ProfileForm } from "@/components/profile-form";
import { AccountSecurity } from "@/components/account-security";
import { requirePageUser } from "@/lib/page-auth";
export default async function ProfilePage(){const user=await requirePageUser();return <PageShell title="个人资料与账号安全" description={`账号角色：${user.role}。你可以在网页中更新资料、撤销所有会话或申请删除个人账号。`} actions={user.role==="STUDENT"?<Link className="button button-secondary" href="/profile/learning">学习档案</Link>:undefined}><ProfileForm name={user.name} email={user.email}/><AccountSecurity /></PageShell>}
