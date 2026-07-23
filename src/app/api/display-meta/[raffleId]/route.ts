import { NextResponse } from "next/server";

import { buildDisplayMeta } from "@/lib/display-meta";

// GET /api/display-meta/[raffleId] — public, read-only (E2-01 Feature 1,
// 4.1a). No auth by design (middleware exempts this prefix); abuse protection
// is platform-level (Netlify edge WAF rate limiting). The response contains
// only structural data — see src/lib/display-meta.ts for the schema that
// excludes entrant data by construction.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raffleId: string }> }
) {
  const { raffleId } = await params;

  const meta = await buildDisplayMeta(raffleId);
  if (!meta) {
    // Unknown raffle ID (or malformed — an ID that matches nothing behaves
    // identically): neutral 404, no detail (Feature 1 Alt 1).
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(meta);
}
