import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getDrawScreenState } from "@/actions/draw";
import { DrawScreen } from "@/components/draw/draw-screen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Draw screen (E1-04): /raffles/[raffleId]/draw. Server component — requires
// raffle status LOCKED, DRAWN, or COMPLETED. For DRAFT/OPEN it renders a
// notice with no draw controls at all (server-side rejection in the action is
// the defense-in-depth backstop, FSD 4.3 Alt 2).

export const dynamic = "force-dynamic";

export default async function DrawPage({
  params,
}: {
  params: Promise<{ raffleId: string }>;
}) {
  const { raffleId } = await params;

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: { id: true, status: true },
  });
  if (!raffle) notFound();

  if (raffle.status === "DRAFT" || raffle.status === "OPEN") {
    return (
      <Alert>
        <AlertTitle>Not ready to draw</AlertTitle>
        <AlertDescription>
          This raffle is not ready to draw. It must be locked first.
        </AlertDescription>
      </Alert>
    );
  }

  const state = await getDrawScreenState(raffleId);
  if (!state) notFound();

  return <DrawScreen state={state} />;
}
