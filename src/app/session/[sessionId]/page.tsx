import { SessionClient } from "@/components/session-client";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/page-auth";
import { requireSessionAccess } from "@/lib/permissions";
import { AppError } from "@/lib/errors";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requirePageUser();
  const session = await requireSessionAccess(user, sessionId).catch((error: unknown) => {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  });
  return <SessionClient sessionId={sessionId} readOnly={session.userId !== user.id} />;
}
