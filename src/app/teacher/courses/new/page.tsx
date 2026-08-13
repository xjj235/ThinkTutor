import { CourseCreateForm } from "@/components/teacher-forms";
import { PageShell } from "@/components/page-shell";
import { requirePageUser } from "@/lib/page-auth";
export default async function NewCoursePage(){await requirePageUser(["TEACHER"]);return <PageShell title="新建课程" description="先建立清晰课程边界，之后再添加章节和学习目标。"><CourseCreateForm/></PageShell>}
