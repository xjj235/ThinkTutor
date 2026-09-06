import { notFound } from "next/navigation";
import { getCourse } from "@/lib/courses-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { ChapterCreateForm, GoalCreateForm } from "@/components/teacher-forms";
export default async function ChaptersPage({params}:{params:Promise<{id:string}>}){const user=await requirePageUser(["TEACHER"]);const {id}=await params;let course;try{course=await getCourse(user,id)}catch{notFound()}return <PageShell title={`${course.title} · 章节与目标`} description="学习目标应当具体、可观察、可通过学生表达验证。">{course.chapters.length?<div className="card-grid">{course.chapters.map(chapter=><article className="card" key={chapter.id}><h2>{chapter.sortOrder}. {chapter.title}</h2><p>{chapter.description}</p>{chapter.goals.length===0?<p>尚未添加学习目标。</p>:null}{chapter.goals.map(goal=><div key={goal.id}><strong>{goal.title}</strong><p>{goal.objective}</p></div>)}<GoalCreateForm chapterId={chapter.id}/></article>)}</div>:<EmptyState title="还没有章节" description="先添加章节，再为章节定义可观察、可验证的学习目标。"/>}<div style={{marginTop:24}}><ChapterCreateForm courseId={course.id}/></div></PageShell>}
