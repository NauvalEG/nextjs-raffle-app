import { notFound } from "next/navigation";

import { getWinnersScreenState } from "@/actions/winners";
import { WinnersTable } from "@/components/winners/winners-table";

// Winners screen (E2-02 Features 4.1–4.4). State is preloaded server-side —
// including the full audit history of every row's supersession chain — so the
// expandable history renders without a lazy fetch.
export default async function WinnersPage({
  params,
}: {
  params: Promise<{ raffleId: string }>;
}) {
  const { raffleId } = await params;
  const state = await getWinnersScreenState(raffleId);
  if (!state) notFound();

  return <WinnersTable state={state} />;
}
