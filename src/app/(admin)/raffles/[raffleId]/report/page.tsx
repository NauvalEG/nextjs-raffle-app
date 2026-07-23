import { notFound } from "next/navigation";

import { getReportData } from "@/lib/report-data";
import { ReportView } from "@/components/report/report-view";

// Results report route (E3-01 Feature 1). The page itself is a thin data
// shell: all UI lives in self-contained components under
// src/components/report/* which import nothing from src/app/(admin)/** —
// satisfying PRD AC5's no-admin-chrome-dependency requirement. The (admin)
// route group layout wrapping this route provides the PIN gate + workspace
// tabs for v1 (the route is admin-gated per FSD §3 assumption A-1); making
// the report public later means moving this file, not refactoring its UI.
// Read-only: rendering performs zero writes, including audit writes (B-3).
export default async function ReportPage({
  params,
}: {
  params: Promise<{ raffleId: string }>;
}) {
  const { raffleId } = await params;
  const data = await getReportData(raffleId);
  if (!data) notFound();

  return <ReportView data={data} />;
}
