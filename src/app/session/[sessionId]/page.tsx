import { SessionClient } from "@/components/session-client";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionClient sessionId={sessionId} />;
}
