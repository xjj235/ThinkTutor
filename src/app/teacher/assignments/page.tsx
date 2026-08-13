import Link from "next/link";
import { requirePageUser } from "@/lib/page-auth";
import { EmptyState, PageShell } from "@/components/page-shell";
import { FilterForm } from "@/components/filter-form";
import { Pagination } from "@/components/pagination";
import { cleanSearch, firstSearchValue, parsePage, type SearchParams } from "@/lib/list-query";
import { listTeacherAssignments } from "@/lib/learning-lists";

const statuses = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;
export default async function TeacherAssignments({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageUser(["TEACHER"]); const parameters = await searchParams;
  const query = cleanSearch(parameters.query); const statusValue = firstSearchValue(parameters.status); const status = statuses.find((value) => value === statusValue); const page = parsePage(parameters.page);
  const data = await listTeacherAssignments(user.id, { page, pageSize: 20, query, status });
  return <PageShell title="学习任务" description="按状态、任务、课程或班级筛选；任务发布后会分配给班级当前成员。" actions={<Link className="button" href="/teacher/assignments/new">创建任务</Link>}><FilterForm resetHref="/teacher/assignments"><label>搜索<input name="query" defaultValue={query} placeholder="任务、课程或班级" maxLength={120}/></label><label>状态<select name="status" defaultValue={status??""}><option value="">全部状态</option>{statuses.map(value=><option key={value}>{value}</option>)}</select></label></FilterForm>{data.items.length?<div className="data-list">{data.items.map(item=><Link className="data-row" href={`/teacher/assignments/${item.id}`} key={item.id}><span className="data-row-detail"><strong>{item.title}</strong><small>{item.course.title} · {item.classroom.name} · {item._count.students} 名学生 · {item._count.sessions} 次会话</small></span><span className="badge">{item.status}</span></Link>)}</div>:<EmptyState title={query||status?"没有匹配任务":"还没有任务"} description={query||status?"调整筛选条件后重试。":"从一个班级和明确学习要求开始。"}/>}<Pagination pathname="/teacher/assignments" page={data.page} totalPages={data.totalPages} query={{query,status}}/></PageShell>;
}
