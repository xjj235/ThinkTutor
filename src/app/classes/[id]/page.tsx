import Link from "next/link";
import { notFound } from "next/navigation";
import { getClassroom } from "@/lib/courses-service";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { LeaveClassButton } from "@/components/leave-class-button";
import { assignmentStatusLabels } from "@/lib/display-labels";
export default async function ClassDetailPage({params}:{params:Promise<{id:string}>}){const user=await requirePageUser(["STUDENT"]);const {id}=await params;let room;try{room=await getClassroom(user,id)}catch{notFound()}return <PageShell title={room.name} description={room.course.title}>{room.assignments.length?<div className="data-list">{room.assignments.map(item=><Link className="data-row" href={`/assignments/${item.id}`} key={item.id}><span><strong>{item.title}</strong><small>{item.description??"教师学习任务"}</small></span><span className="badge">{assignmentStatusLabels[item.status]}</span></Link>)}</div>:<EmptyState title={room.status==="ARCHIVED"?"班级已归档":"暂无学习任务"} description={room.status==="ARCHIVED"?"已有学习记录和报告仍可在学习档案查看。":"教师发布任务后，会显示在这里。"}/>}<LeaveClassButton classroomId={id}/></PageShell>}
