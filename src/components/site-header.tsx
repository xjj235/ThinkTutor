import { getCurrentUser } from "@/lib/auth/session";
import { SiteNavigation } from "./site-navigation";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return <SiteNavigation user={user} />;
}
