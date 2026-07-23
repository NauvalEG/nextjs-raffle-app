import type { Metadata } from "next";

import { DisplayBoard } from "@/components/display/display-board";

// Public projector page (E2-01 Feature 1): /display/[raffleId].
// Route isolation (BR4): no auth, no admin layout/chrome, no imports from
// (admin) or admin components anywhere in this tree. The middleware exempts
// /display from the PIN gate. This server shell performs NO data fetch —
// the client board's display-meta fetch is the page's only server contact
// (BR2), and structure is load-time-static (BR7 / D-E26: no status gating).

export const metadata: Metadata = {
  title: "Raffle Display",
};

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ raffleId: string }>;
}) {
  const { raffleId } = await params;
  return <DisplayBoard raffleId={raffleId} />;
}
