import "server-only";

import type { AuthUser } from "./auth/session";
import { prisma } from "./db";
import { requireOwnedClassroom } from "./permissions";

export async function getStudentAnalytics(userId: string) {
  const [totalSessions, completedSessions, reports, openGaps, recentSessions] = await Promise.all([
    prisma.learningSession.count({ where: { userId } }),
    prisma.learningSession.count({ where: { userId, phase: "COMPLETED" } }),
    prisma.learningReport.findMany({ where: { session: { userId } }, select: { overallScore: true } }),
    prisma.learningGap.count({ where: { report: { session: { userId } }, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.learningSession.findMany({
      where: { userId },
      select: { id: true, topic: true, objective: true, phase: true, source: true, updatedAt: true, report: { select: { overallScore: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);
  const averageScore = reports.length ? Math.round(reports.reduce((sum, report) => sum + report.overallScore, 0) / reports.length) : null;
  return { totalSessions, completedSessions, averageScore, openGaps, recentSessions };
}

export async function getTeacherClassAnalytics(user: AuthUser, classroomId: string) {
  await requireOwnedClassroom(user, classroomId);
  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: classroomId },
    select: {
      id: true,
      name: true,
      course: { select: { id: true, title: true } },
      enrollments: { where: { status: "ACTIVE" }, select: { user: { select: { id: true, name: true, email: true } } } },
      assignments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          students: { select: { progress: true, studentId: true } },
          sessions: { where: { phase: "COMPLETED" }, select: { userId: true, report: { select: { overallScore: true } } } },
        },
      },
    },
  });
  return {
    ...classroom,
    assignments: classroom.assignments.map((assignment) => {
      const scores = assignment.sessions.flatMap((session) => session.report ? [session.report.overallScore] : []);
      return {
        id: assignment.id,
        title: assignment.title,
        status: assignment.status,
        dueAt: assignment.dueAt,
        assignedCount: assignment.students.length,
        completedCount: assignment.students.filter((student) => student.progress === "COMPLETED").length,
        averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      };
    }),
  };
}
