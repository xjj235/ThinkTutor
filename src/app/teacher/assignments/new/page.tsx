import { AssignmentCreateForm } from "@/components/teacher-forms";
import { PageShell } from "@/components/page-shell";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/page-auth";

export default async function NewAssignmentPage() {
  const user = await requirePageUser(["TEACHER"]);
  const classrooms = await prisma.classroom.findMany({
    where: { teacherId: user.id, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      courseId: true,
      course: {
        select: {
          title: true,
          chapters: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              title: true,
              goals: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, title: true, objective: true },
              },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return (
    <PageShell title="创建学习任务" description="任务先保存为草稿；确认内容后再发布给班级。">
      <AssignmentCreateForm classrooms={classrooms} />
    </PageShell>
  );
}
