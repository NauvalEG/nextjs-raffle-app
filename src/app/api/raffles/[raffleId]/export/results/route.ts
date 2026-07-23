import { hasValidSession } from "@/lib/session";
import { getResultsExportRows } from "@/lib/report-data";
import { UTF8_BOM, buildCsv } from "@/lib/csv";

// Results CSV export (E3-01 Feature 2). Admin-gated: middleware covers this
// path, and the handler re-validates the session itself (defense in depth) —
// unauthenticated requests receive zero CSV bytes (B-16). The FULL row set is
// resolved before any byte is written, so a failure yields a clean error
// response, never a truncated file (FSD §7). Generated per request, never
// stored, never audit-logged (B-16, B-17 / D-E28). The route does not block
// on raffle status (D-E27) — the pre-completion confirmation is client-side.

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
    data = await getResultsExportRows(raffleId);
  } catch {
    return new Response("Export failed. Try again.", { status: 500 });
  }
  if (!data) {
    return new Response("Raffle not found.", { status: 404 });
  }

  // Zero-entrant raffle → BOM + header only, still a valid 200 (Alt 3).
  const body = UTF8_BOM + buildCsv([data.header, ...data.rows]);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // D-E22 filename convention.
      "Content-Disposition": `attachment; filename="raffle-${raffleId}-results.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
