import { LearningEntry } from "@/components/learning-entry";
import { requirePageUser } from "@/lib/page-auth";

export default async function DashboardPage() {
  await requirePageUser(["STUDENT"]);
  return <main id="main-content" className="home-page"><LearningEntry signedIn /></main>;
}
