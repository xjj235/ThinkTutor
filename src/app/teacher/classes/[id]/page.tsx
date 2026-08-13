import Link from "next/link";
import { notFound } from "next/navigation";
import { getClassroom } from "@/lib/courses-service";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";
export default async function TeacherClassPage({params}:{params:Promise<{id:string}>}){const user=await requirePageUser(["TEACHER"]);const {id}=await params;let room;try{room=await getClassroom(user,id)}catch{notFound()}return <PageShell title={room.name} description={`${room.course.title} · 加入码 ${room.joinCode}`} actions={<Link className="button" href={`/teacher/classes/${id}/analytics`}>学习分析</Link>}><h2>学生</h2><div className="data-list">{room.enrollments.map(item=><div className="data-row" key={item.id}><span><strong>{item.user.name}</strong><small>{item.user.email}</small></span></div>)}</div><h2>任务</h2><div className="data-list">{room.assignments.map(item=><Link className="data-row" href={`/teacher/assignments/${item.id}`} key={item.id}><strong>{item.title}</strong><span className="badge">{item.status}</span></Link>)}</div></PageShell>}
