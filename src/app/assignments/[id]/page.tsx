import { notFound } from "next/navigation";
import { getAssignment } from "@/lib/courses-service";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";
import { StartAssignmentButton } from "@/components/start-assignment-button";
export default async function AssignmentPage({params}:{params:Promise<{id:string}>}){const user=await requirePageUser(["STUDENT"]);const {id}=await params;let item;try{item=await getAssignment(user,id)}catch{notFound()}return <PageShell title={item.title} description={`${item.course.title} · ${item.classroom.name}`}><article className="card"><h2>学习要求</h2><p>{item.instructions}</p><dl><dt>学习水平</dt><dd>{item.learnerLevel}</dd><dt>截止时间</dt><dd>{item.dueAt?new Intl.DateTimeFormat("zh-CN",{dateStyle:"long",timeStyle:"short"}).format(item.dueAt):"未设置"}</dd></dl><StartAssignmentButton assignmentId={item.id}/></article></PageShell>}
