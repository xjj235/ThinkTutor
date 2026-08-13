import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";
import { getServerEnv } from "@/lib/env";
export default async function AdminSystemPage(){await requirePageUser(["ADMIN"]);const env=getServerEnv();return <PageShell title="系统配置" description="只展示非敏感运行配置，不展示任何密钥。"><div className="data-list"><div className="data-row"><strong>AI Provider</strong><span>{env.AI_PROVIDER}</span></div><div className="data-row"><strong>模型</strong><span>{env.DEEPSEEK_MODEL}</span></div><div className="data-row"><strong>存储</strong><span>{env.STORAGE_PROVIDER}</span></div><div className="data-row"><strong>Redis / Tair</strong><span>{env.REDIS_URL?"已配置":"未配置（仅开发回退）"}</span></div></div></PageShell>}
