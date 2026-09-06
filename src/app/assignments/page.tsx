import Link from "next/link";
import { EmptyState, PageShell } from "@/components/page-shell";
import { prisma } from "@/lib/db";
import { assignmentProgressLabels } from "@/lib/display-labels";
import { requirePageUser } from "@/lib/page-auth";

const formatDate = (value: Date | null) => value ? new Intl.DateTimeFormat("zh-CN").format(value) : "未设置截止";

export default async function AssignmentsPage(){const user=await requirePageUser(["STUDENT"]);const items=await prisma.assignmentStudent.findMany({where:{studentId:user.id,assignment:{status:"PUBLISHED"}},include:{assignment:{include:{classroom:true,course:true}}},orderBy:{updatedAt:"desc"}});return <PageShell title="课程任务" description="教师发布的学习主题与目标。">{items.length?<div className="data-list">{items.map(({assignment,progress})=><Link className="data-row" href={`/assignments/${assignment.id}`} key={assignment.id}><span><strong>{assignment.title}</strong><small>{assignment.course.title} · {assignment.classroom.name} · 截止 {formatDate(assignment.dueAt)}</small></span><span className="badge">{assignmentProgressLabels[progress]}</span></Link>)}</div>:<EmptyState title="暂无教师任务" description="加入班级后，教师发布的任务会出现在这里。"/>}</PageShell>}
