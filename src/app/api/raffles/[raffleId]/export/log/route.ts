import { hasValidSession } from "@/lib/session";
import { getLogExportRows } from "@/lib/report-data";
import { UTF8_BOM, buildCsv } from "@/lib/csv";

// Complete log CSV export (E3-01 Feature 3). Identical gating, encoding, and
// no-partial-file behavior as the results export (B-22): session re-validated
// in-handler (zero CSV bytes when unauthenticated), full row set resolved
// before responding, BOM + RFC 4180 + formula hardening via csv.ts, generated
// per request and never stored or audit-logged (B-16, B-21 / D-E28). No
// status gating (D-E27).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raffleId: string }> }
): Promise<Response> {
  if (!(await hasValidSession())) {
    return new Response(null, { status: 401 });
  }

  const { raffleId } = await params;

  let data;
  try {
    data = await getLogExportRows(raffleId);
  } catch {
    return new Response("Export failed. Try again.", { status: 500 });
  }
  if (!data) {
    return new Response("Raffle not found.", { status: 404 });
  }

  // Empty audit log → BOM + header only, still a valid 200 (Alt 1).
  const body = UTF8_BOM + buildCsv([data.header, ...data.rows]);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // D-E22 filename convention.
      "Content-Disposition": `attachment; filename="raffle-${raffleId}-log.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
