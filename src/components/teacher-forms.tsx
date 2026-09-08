"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AsyncFeedback, type AsyncFeedbackState } from "./async-feedback";
import { readApiResponse } from "@/lib/client-api";

type JsonData = { id?:string };
async function postJson(path:string,body:unknown,method="POST"){const response=await fetch(path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});return readApiResponse<JsonData>(response,"请求失败，请重试。")}
function Status({message}:{message:string}){const state:AsyncFeedbackState=!message?{kind:"idle",message:""}:message.startsWith("错误")?{kind:"error",message:message.slice(3),retryable:false}:{kind:"success",message};return <AsyncFeedback state={state}/>}

export function CourseCreateForm(){const router=useRouter();const[pending,setPending]=useState(false);const[message,setMessage]=useState("");return <form className="stack-form card catalog-form" onSubmit={async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setPending(true);setMessage("");const f=new FormData(e.currentTarget);try{const data=await postJson("/api/courses",{title:String(f.get("title")),description:String(f.get("description"))||undefined,subject:String(f.get("subject"))||undefined,audience:String(f.get("audience"))||undefined});router.push(`/teacher/courses/${data?.id}`);router.refresh()}catch(error){setMessage(`错误：${error instanceof Error?error.message:"创建失败"}`)}finally{setPending(false)}}}><label>课程名称<input name="title" required minLength={2} maxLength={120}/></label><label>学科<input name="subject" maxLength={100}/></label><label>适合人群<input name="audience" maxLength={200}/></label><label>课程说明<textarea name="description" rows={5} maxLength={2000}/></label><Status message={message}/><button className="button" disabled={pending}>{pending?"创建中…":"创建课程"}</button></form>}

export function ChapterCreateForm({courseId}:{courseId:string}){const router=useRouter();const[pending,setPending]=useState(false);const[message,setMessage]=useState("");return <form className="stack-form card catalog-form" onSubmit={async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setPending(true);const f=new FormData(e.currentTarget);try{await postJson(`/api/courses/${courseId}/chapters`,{title:String(f.get("title")),description:String(f.get("description"))||undefined,sortOrder:Number(f.get("sortOrder"))});setMessage("章节已创建。");e.currentTarget.reset();router.refresh()}catch(error){setMessage(`错误：${error instanceof Error?error.message:"创建失败"}`)}finally{setPending(false)}}}><h2>添加章节</h2><label>章节名称<input name="title" required minLength={2}/></label><label>顺序<input name="sortOrder" type="number" defaultValue="1" min="0" required/></label><label>说明<textarea name="description" rows={3}/></label><Status message={message}/><button className="button" disabled={pending}>添加章节</button></form>}

export function GoalCreateForm({chapterId}:{chapterId:string}){const router=useRouter();const[pending,setPending]=useState(false);const[message,setMessage]=useState("");return <form className="stack-form card catalog-form" onSubmit={async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setPending(true);const f=new FormData(e.currentTarget);try{await postJson(`/api/chapters/${chapterId}/goals`,{title:String(f.get("title")),objective:String(f.get("objective")),sortOrder:Number(f.get("sortOrder")),expectedLevel:String(f.get("expectedLevel"))||undefined});setMessage("目标已创建。");e.currentTarget.reset();router.refresh()}catch(error){setMessage(`错误：${error instanceof Error?error.message:"创建失败"}`)}finally{setPending(false)}}}><h3>添加学习目标</h3><label>目标标题<input name="title" required minLength={2}/></label><label>可验证目标<textarea name="objective" required minLength={10} rows={3}/></label><label>预期水平<input name="expectedLevel"/></label><label>顺序<input name="sortOrder" type="number" defaultValue="1" min="0" required/></label><Status message={message}/><button className="button button-secondary" disabled={pending}>添加目标</button></form>}

export function ClassroomCreateForm({courses}:{courses:Array<{id:string;title:string}>}){const router=useRouter();const[pending,setPending]=useState(false);const[message,setMessage]=useState("");return <form className="stack-form card catalog-form" onSubmit={async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setPending(true);const f=new FormData(e.currentTarget);try{const data=await postJson("/api/classes",{courseId:String(f.get("courseId")),name:String(f.get("name")),description:String(f.get("description"))||undefined});router.push(`/teacher/classes/${data?.id}`);router.refresh()}catch(error){setMessage(`错误：${error instanceof Error?error.message:"创建失败"}`)}finally{setPending(false)}}}><h2>创建班级</h2><label>课程<select name="courseId" required><option value="">请选择</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label>班级名称<input name="name" required minLength={2}/></label><label>说明<textarea name="description" rows={3}/></label><Status message={message}/><button className="button" disabled={pending}>创建班级</button></form>}

type AssignmentClassroom = {
  id: string;
  name: string;
  courseId: string;
  course: {
    title: string;
    chapters: Array<{
      id: string;
      title: string;
      goals: Array<{ id: string; title: string; objective: string }>;
    }>;
  };
};

export function AssignmentCreateForm({ classrooms }: { classrooms: AssignmentClassroom[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const selectedClassroom = classrooms.find((classroom) => classroom.id === classroomId);
  const chapters = selectedClassroom?.course.chapters ?? [];
  const goals = chapters
    .filter((chapter) => !chapterId || chapter.id === chapterId)
    .flatMap((chapter) => chapter.goals.map((goal) => ({ ...goal, chapterId: chapter.id })));

  return (
    <form
      className="stack-form card catalog-form"
      onSubmit={async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPending(true);
        const form = new FormData(event.currentTarget);
        const room = classrooms.find((classroom) => classroom.id === classroomId);
        try {
          if (!room) throw new Error("请选择班级。");
          const data = await postJson("/api/assignments", {
            classroomId,
            courseId: room.courseId,
            chapterId: String(form.get("chapterId")) || undefined,
            learningGoalId: String(form.get("learningGoalId")) || undefined,
            title: String(form.get("title")),
            instructions: String(form.get("instructions")),
            description: String(form.get("description")) || undefined,
            learnerLevel: String(form.get("learnerLevel")),
            openAt: String(form.get("openAt")) || undefined,
            dueAt: String(form.get("dueAt")) || undefined,
            maxAttempts: Number(form.get("maxAttempts")),
          });
          router.push(`/teacher/assignments/${data?.id}`);
          router.refresh();
        } catch (error) {
          setMessage(`错误：${error instanceof Error ? error.message : "创建失败"}`);
        } finally {
          setPending(false);
        }
      }}
    >
      <label>
        班级
        <select name="classroomId" required value={classroomId} onChange={(event) => { setClassroomId(event.target.value); setChapterId(""); }}>
          <option value="">请选择</option>
          {classrooms.map((classroom) => (
            <option key={classroom.id} value={classroom.id}>
              {classroom.name} · {classroom.course.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        章节（可选）
        <select name="chapterId" value={chapterId} disabled={!selectedClassroom} onChange={(event) => setChapterId(event.target.value)}>
          <option value="">不限定章节</option>
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>{chapter.title}</option>
          ))}
        </select>
      </label>
      <label>
        学习目标（可选）
        <select name="learningGoalId" disabled={!selectedClassroom}>
          <option value="">按任务要求学习</option>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>{goal.title}</option>
          ))}
        </select>
      </label>
      <label>任务名称<input name="title" required minLength={2} maxLength={160} /></label>
      <label>学习要求<textarea name="instructions" required minLength={10} maxLength={4000} rows={5} /></label>
      <label>补充说明<textarea name="description" rows={3} maxLength={2000} /></label>
      <label>学习者水平<input name="learnerLevel" defaultValue="入门" required maxLength={100} /></label>
      <label>开放时间<input name="openAt" type="datetime-local" /></label>
      <label>截止时间<input name="dueAt" type="datetime-local" /></label>
      <label>最大尝试次数<input name="maxAttempts" type="number" min="1" max="20" defaultValue="1" required /></label>
      <Status message={message} />
      <button className="button" disabled={pending}>{pending ? "创建中…" : "创建草稿"}</button>
    </form>
  );
}

export function PublishAssignmentButton({assignmentId,disabled}:{assignmentId:string;disabled:boolean}){const router=useRouter();const[pending,setPending]=useState(false);const[message,setMessage]=useState("");return <div><button className="button" disabled={disabled||pending} onClick={async()=>{setPending(true);try{await postJson(`/api/assignments/${assignmentId}/publish`,{});router.refresh()}catch(error){setMessage(`错误：${error instanceof Error?error.message:"发布失败"}`)}finally{setPending(false)}}}>{pending?"发布中…":disabled?"已发布":"发布给班级"}</button><Status message={message}/></div>}
