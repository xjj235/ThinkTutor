import { CourseCreateForm } from "@/components/teacher-forms";
import { PageShell } from "@/components/page-shell";
import { requirePageUser } from "@/lib/page-auth";
export default async function NewCoursePage(){await requirePageUser(["TEACHER"]);return <PageShell title="新建课程" description="课程范围、适用对象与教学定位。"><CourseCreateForm/></PageShell>}
