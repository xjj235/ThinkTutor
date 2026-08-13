import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell, EmptyState } from "@/components/page-shell";
import { ClassroomCreateForm } from "@/components/teacher-forms";
export default async function TeacherClasses(){const user=await requirePageUser(["TEACHER"]);const [classes,courses]=await Promise.all([prisma.classroom.findMany({where:{teacherId:user.id},include:{course:true,_count:{select:{enrollments:true,assignments:true}}},orderBy:{updatedAt:"desc"}}),prisma.course.findMany({where:{ownerId:user.id,status:{not:"ARCHIVED"}},select:{id:true,title:true}})]);return <PageShell title="班级" description="班级加入码应只分享给对应学习者。">{classes.length?<div className="card-grid">{classes.map(room=><article className="card" key={room.id}><h2>{room.name}</h2><p>{room.course.title} · {room._count.enrollments} 名成员 · {room._count.assignments} 项任务</p><p>加入码：<strong>{room.joinCode}</strong></p><Link href={`/teacher/classes/${room.id}`}>管理班级</Link></article>)}</div>:<EmptyState title="还没有班级" description="先创建课程，然后建立班级。"/>}<div style={{marginTop:24}}><ClassroomCreateForm courses={courses}/></div></PageShell>}
