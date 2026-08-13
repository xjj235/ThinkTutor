import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { JoinClassForm } from "@/components/join-class-form";
export default async function ClassesPage(){const user=await requirePageUser(["STUDENT"]);const memberships=await prisma.enrollment.findMany({where:{userId:user.id,status:"ACTIVE"},include:{classroom:{include:{course:true,_count:{select:{assignments:true}}}}},orderBy:{joinedAt:"desc"}});return <PageShell title="我的班级" description="通过教师提供的班级 ID 和加入码加入课程。"><div className="card-grid">{memberships.map(({classroom})=><article className="card" key={classroom.id}><h2>{classroom.name}</h2><p>{classroom.course.title} · {classroom._count.assignments} 项任务</p><Link href={`/classes/${classroom.id}`}>查看班级</Link></article>)}</div>{memberships.length===0?<EmptyState title="尚未加入班级" description="向教师索取班级 ID 与加入码。"/>:null}<div style={{marginTop:24}}><JoinClassForm/></div></PageShell>}
