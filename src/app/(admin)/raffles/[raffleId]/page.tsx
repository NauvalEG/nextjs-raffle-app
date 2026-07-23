import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { isStructureMutable } from "@/lib/lifecycle";

import { DetailsForm } from "./details-form";
import { LifecycleControls } from "./lifecycle-controls";
import { PrizeTypesSection } from "./prize-types-section";

export const metadata: Metadata = {
  title: "Setup — Raffle App",
};

export const dynamic = "force-dynamic";

// Setup screen (E1-01 Features C, D, E). Lock (OPEN→LOCKED) is E1-03's UI;
// LOCKED→DRAWN is the draw engine's (E1-04). Neither is rendered here.
export default async function RaffleSetupPage({
  params,
}: {
  params: Promise<{ raffleId: string }>;
}) {
  const { raffleId } = await params;

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    include: {
      prizeTypes: {
        orderBy: { name: "asc" },
        include: { _count: { select: { allocations: true } } },
      },
    },
  });
  if (!raffle) notFound();

  const mutable = isStructureMutable(raffle.status);

  return (
    <div className="space-y-6">
      <DetailsForm
        raffleId={raffle.id}
        initialTitle={raffle.title}
        initialDescription={raffle.description ?? ""}
        mutable={mutable}
      />
      <PrizeTypesSection
        raffleId={raffle.id}
        prizeTypes={raffle.prizeTypes.map((pt) => ({
          id: pt.id,
          name: pt.name,
          allocationCount: pt._count.allocations,
        }))}
        mutable={mutable}
      />
      <LifecycleControls raffleId={raffle.id} status={raffle.status} />
    </div>
  );
}
