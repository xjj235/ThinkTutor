import { notFound } from "next/navigation";
import { getCourse } from "@/lib/courses-service";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { MaterialUploadForm } from "@/components/material-upload-form";
import { MaterialActions } from "@/components/material-actions";
import { materialStatusLabels } from "@/lib/display-labels";
import { getServerEnv } from "@/lib/env";
export default async function MaterialsPage({params}:{params:Promise<{id:string}>}){const user=await requirePageUser(["TEACHER"]);const {id}=await params;let course;try{course=await getCourse(user,id)}catch{notFound()}const competition=getServerEnv().DEPLOYMENT_ENV==="competition";const materials=await prisma.material.findMany({where:{courseId:id,status:{not:"DELETED"}},orderBy:{updatedAt:"desc"},include:{_count:{select:{chunks:true}}}});return <PageShell title={`${course.title} · 课程材料`} description={competition?"比赛体验环境暂不支持文件上传与处理；已有材料仍可查看。":"文件保存在私有对象存储，后台提取文本并建立课程内检索片段。所有上传、重试和删除操作都可在本页完成。"}>{materials.length?<div className="data-list">{materials.map(item=><div className="data-row material-row" key={item.id}><span><strong>{item.title}</strong><small>{item.originalName} · {item._count.chunks} 个片段</small></span><div><span className="badge">{materialStatusLabels[item.status]}</span>{competition?null:<MaterialActions id={item.id} title={item.title} status={item.status}/>}</div></div>)}</div>:<EmptyState title="还没有课程材料" description={competition?"请使用学习页面中已提供的学习资料。":"上传第一份教师或课程材料后，处理状态会显示在这里。"}/>} {competition?null:<div className="section-gap"><MaterialUploadForm courseId={id} chapters={course.chapters}/></div>}</PageShell>}
