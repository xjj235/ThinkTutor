import { TaskForm } from "@/components/task-form";
import { PageShell } from "@/components/page-shell";
import { requirePageUser } from "@/lib/page-auth";
import { listCourses } from "@/lib/courses-service";
export default async function NewLearningPage(){const user=await requirePageUser(["STUDENT"]);const courses=await listCourses(user);const curriculum=courses.map(course=>({id:course.id,title:course.title,chapters:course.chapters.map(chapter=>({id:chapter.id,title:chapter.title,goals:chapter.goals.map(goal=>({id:goal.id,title:goal.title,objective:goal.objective,expectedLevel:goal.expectedLevel}))}))}));return <PageShell title="开始自主学习" description="可以从已加入课程的章节和学习目标开始，也可以创建一个独立的自主学习任务。"><section className="card"><TaskForm courses={curriculum}/></section></PageShell>}
