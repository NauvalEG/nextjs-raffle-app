import { notFound } from "next/navigation";

import { db } from "@/lib/db";

import { RaffleStatusBadge } from "../status-badge";
import { RaffleTabs } from "./raffle-tabs";

// Raffle workspace shell: title + status header and tab navigation. Tab
// targets other than Setup are delivered by E1-02/E1-03/E1-04/E2-02/E3-01
// and may 404 until those epics land — the links render regardless.
export default async function RaffleWorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ raffleId: string }>;
  children: React.ReactNode;
}) {
  const { raffleId } = await params;

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: { id: true, title: true, status: true },
  });
  if (!raffle) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{raffle.title}</h1>
        <RaffleStatusBadge status={raffle.status} />
      </div>
      <RaffleTabs raffleId={raffle.id} />
      <div>{children}</div>
    </div>
  );
}
