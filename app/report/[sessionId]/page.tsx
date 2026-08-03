import { ReportClient } from "@/components/report-client";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ReportClient sessionId={sessionId} />;
}
