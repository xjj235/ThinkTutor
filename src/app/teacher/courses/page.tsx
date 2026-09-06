import Link from "next/link";
import { listCourses } from "@/lib/courses-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { courseStatusLabels } from "@/lib/display-labels";
export default async function TeacherCoursesPage(){const user=await requirePageUser(["TEACHER"]);const courses=await listCourses(user);return <PageShell title="课程" description="课程是章节、学习目标、材料、班级和任务的知识边界。" actions={<Link className="button" href="/teacher/courses/new">新建课程</Link>}>{courses.length?<div className="card-grid">{courses.map(course=><article className="card" key={course.id}><span className="badge">{courseStatusLabels[course.status]}</span><h2>{course.title}</h2><p>{course.description??"尚未填写课程说明。"}</p><p>{course.chapters.length} 章 · {course._count.materials} 份材料 · {course._count.classrooms} 个班级</p><Link href={`/teacher/courses/${course.id}`}>管理课程</Link></article>)}</div>:<EmptyState title="还没有课程" description="先创建课程，再添加章节、目标和材料。"/>}</PageShell>}
