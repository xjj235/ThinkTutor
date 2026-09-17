import { TaskForm } from "@/components/task-form";
import { PageShell } from "@/components/page-shell";
import { requirePageUser } from "@/lib/page-auth";
import { listCourses } from "@/lib/courses-service";
import { getServerEnv } from "@/lib/env";
import { getStudentKnowledgeCatalog } from "@/lib/knowledge/student-catalog";

export default async function NewLearningPage() {
  const user = await requirePageUser(["STUDENT"]);
  const courses = await listCourses(user);
  const curriculum = courses.map((course) => ({
    id: course.id,
    title: course.title,
    chapters: course.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      goals: chapter.goals.map((goal) => ({ id: goal.id, title: goal.title, objective: goal.objective, expectedLevel: goal.expectedLevel })),
    })),
  }));
  const env = getServerEnv();
  return <PageShell title="创建研习任务" description="确立学习主题与预期目标。">
    <TaskForm courses={curriculum} knowledgeTopics={getStudentKnowledgeCatalog()} referencePreviewEnabled={env.DEPLOYMENT_ENV !== "production" && env.ALLOW_DRAFT_KNOWLEDGE} />
  </PageShell>;
}
