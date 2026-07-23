import type { Prisma, PrismaClient } from "@prisma/client";

// THE single shared allocation computation (E1-03 Feature C Rule 3): the live
// "X of Y entrants allocated" counter and the server-side lock validation both
// call this function so the two can never drift. Computed as DB aggregates —
// never by loading row sets into memory (E1-03 NFR "Scale of computation").
//
// Callers that need transactional consistency (the lock action) pass their
// Prisma.TransactionClient so the numbers are read inside the transaction.

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type AllocationSummary = {
  /** Sum of `quantity` across all allocations in all rounds of the raffle ("X"). */
  totalPlanned: number;
  /** Count of the raffle's entries ("Y"). */
  entryCount: number;
};

export async function getAllocationSummary(
  client: DbClient,
  raffleId: string
): Promise<AllocationSummary> {
  const [quantitySum, entryCount] = await Promise.all([
    client.roundAllocation.aggregate({
      _sum: { quantity: true },
      where: { round: { raffleId } },
    }),
    client.entry.count({ where: { raffleId } }),
  ]);

  return {
    totalPlanned: quantitySum._sum.quantity ?? 0,
    entryCount,
  };
}
