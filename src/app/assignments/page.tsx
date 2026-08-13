import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
export default async function AssignmentsPage(){const user=await requirePageUser(["STUDENT"]);const items=await prisma.assignmentStudent.findMany({where:{studentId:user.id,assignment:{status:"PUBLISHED"}},include:{assignment:{include:{classroom:true,course:true}}},orderBy:{updatedAt:"desc"}});return <PageShell title="学习任务" description="来自已加入班级的教师任务。">{items.length?<div className="data-list">{items.map(({assignment,progress})=><Link className="data-row" href={`/assignments/${assignment.id}`} key={assignment.id}><span><strong>{assignment.title}</strong><small>{assignment.course.title} · {assignment.classroom.name}</small></span><span className="badge">{progress}</span></Link>)}</div>:<EmptyState title="暂无教师任务" description="加入班级后，教师发布的任务会出现在这里。"/>}</PageShell>}
