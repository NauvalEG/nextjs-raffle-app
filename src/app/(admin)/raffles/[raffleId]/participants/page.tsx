import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { isStructureMutable } from "@/lib/lifecycle";
import { sortByTicket } from "@/lib/ticket";
import { ParticipantsView } from "@/components/participants/participants-view";

// Participant management screen (E1-02). Server component: loads the raffle
// (status gates the mutation controls) and the full entrant list sorted by
// ticket/ID ascending (FSD A14). Ticket/IDs are text (D-E29), so the natural
// ordering is applied in memory — a SQL ORDER BY would list "1, 10, 2". All
// interactivity lives in the client ParticipantsView; every mutation is
// re-validated server-side regardless.

export default async function ParticipantsPage({
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
      entries: {
        select: {
          id: true,
          ticketNumber: true,
          fullName: true,
          contact: true,
          createdAt: true,
        },
      },
    },
  });

  if (!raffle) notFound();

  return (
    <ParticipantsView
      raffleId={raffle.id}
      raffleTitle={raffle.title}
      raffleStatus={raffle.status}
      mutable={isStructureMutable(raffle.status)}
      entries={sortByTicket(raffle.entries).map((e) => ({
        id: e.id,
        ticketNumber: e.ticketNumber,
        fullName: e.fullName,
        contact: e.contact,
        createdAt: e.createdAt.toISOString(),
      }))}
    />
  );
}
