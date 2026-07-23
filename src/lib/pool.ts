import type { Prisma, PrismaClient } from "@prisma/client";

// Live eligible-pool computation (E1-04 Feature 4.2) — the ONE pool function
// shared by round execution and E2-02 redraw. Never cached, never memoized:
// callers must invoke it at execution time, inside their transaction where
// consistency matters.
//
// Semantics (engineering decision D-E01, the FSD's stricter reading):
//   Eligible = entries of the raffle with
//     - no DrawEvent in status PENDING or CLAIMED (active win), AND
//     - no DrawEvent in status DISQUALIFIED (permanent exclusion).
//   RELEASED_TO_POOL events do not exclude — released entrants re-enter.
//   Supersession does not matter here: a superseded event keeps its terminal
//   status, so a disqualified-then-redrawn original's winner stays excluded.

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type PoolEntry = {
  id: string;
  ticketNumber: number;
  fullName: string;
};

export async function getEligiblePool(
  client: DbClient,
  raffleId: string
): Promise<PoolEntry[]> {
  return client.entry.findMany({
    where: {
      raffleId,
      drawEvents: {
        none: {
          status: { in: ["PENDING", "CLAIMED", "DISQUALIFIED"] },
        },
      },
    },
    select: { id: true, ticketNumber: true, fullName: true },
    orderBy: { ticketNumber: "asc" },
  });
}
