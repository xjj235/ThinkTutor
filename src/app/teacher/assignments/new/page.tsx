import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { PageShell } from "@/components/page-shell";
import { AssignmentCreateForm } from "@/components/teacher-forms";
export default async function NewAssignmentPage(){const user=await requirePageUser(["TEACHER"]);const classrooms=await prisma.classroom.findMany({where:{teacherId:user.id,status:"ACTIVE"},select:{id:true,name:true,courseId:true,course:{select:{title:true}}},orderBy:{name:"asc"}});return <PageShell title="创建学习任务" description="任务先保存为草稿；确认内容后再发布给班级。"><AssignmentCreateForm classrooms={classrooms}/></PageShell>}
