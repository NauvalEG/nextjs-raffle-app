import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { getAllocationSummary } from "@/lib/allocation";
import { RoundsBuilder } from "@/components/rounds/rounds-builder";
import { Badge } from "@/components/ui/badge";

// Rounds screen (E1-03): /raffles/[raffleId]/rounds. Server component — loads
// the raffle's rounds (ordered), allocations, prize types, and the shared
// allocation summary (same computation the lock validation uses), then hands
// everything to the client builder. When the raffle is past OPEN the builder
// renders fully read-only.

export const dynamic = "force-dynamic";

export default async function RoundsPage({
  params,
}: {
  params: Promise<{ raffleId: string }>;
}) {
  const { raffleId } = await params;

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: {
      id: true,
      title: true,
      status: true,
      prizeTypes: {
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      },
      rounds: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          label: true,
          revealMode: true,
          allocations: {
            orderBy: { id: "asc" },
            select: { id: true, prizeTypeId: true, quantity: true },
          },
        },
      },
    },
  });
  if (!raffle) notFound();

  const { totalPlanned, entryCount } = await getAllocationSummary(db, raffleId);
  const editable = raffle.status === "DRAFT" || raffle.status === "OPEN";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Rounds</h1>
          <Badge variant={editable ? "secondary" : "outline"}>
            {raffle.status.charAt(0) + raffle.status.slice(1).toLowerCase()}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {raffle.title}
          {editable
            ? " — structure the event into ordered rounds with prize allocations, then lock."
            : " — this raffle is locked; rounds and allocations are read-only."}
        </p>
      </header>

      <RoundsBuilder
        raffleId={raffle.id}
        status={raffle.status}
        rounds={raffle.rounds}
        prizeTypes={raffle.prizeTypes}
        totalPlanned={totalPlanned}
        entryCount={entryCount}
      />
    </div>
  );
}
