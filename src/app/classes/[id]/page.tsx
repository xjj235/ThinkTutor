import Link from "next/link";
import { notFound } from "next/navigation";
import { getClassroom } from "@/lib/courses-service";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";
export default async function ClassDetailPage({params}:{params:Promise<{id:string}>}){const user=await requirePageUser(["STUDENT"]);const {id}=await params;let room;try{room=await getClassroom(user,id)}catch{notFound()}return <PageShell title={room.name} description={room.course.title}><div className="data-list">{room.assignments.map(item=><Link className="data-row" href={`/assignments/${item.id}`} key={item.id}><span><strong>{item.title}</strong><small>{item.description??"教师学习任务"}</small></span><span className="badge">{item.status}</span></Link>)}</div></PageShell>}
