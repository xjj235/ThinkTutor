import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { SiteNavigation } from "./site-navigation";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return <header className="site-header"><div className="site-header-inner"><Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">问</span><span className="brand-copy"><strong>问思学伴</strong><small>ThinkTutor</small></span></Link><SiteNavigation user={user} /></div></header>;
}
