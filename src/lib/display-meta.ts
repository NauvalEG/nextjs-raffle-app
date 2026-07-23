import { z } from "zod";

import { db } from "@/lib/db";
import { slotId } from "@/lib/broadcast";

// Display-meta contract (E2-01 Feature 1, 4.1a / BR3). The response schema
// STRUCTURALLY excludes entrant data: no field for entrant names, ticket
// numbers, contact, draw outcomes, statuses, or reasons exists here — the
// exclusion is by construction of the schema and of the Prisma select below,
// not by filtering a wider object. E3-02 asserts against this schema.

export const displayMetaSchema = z.object({
  /** Raffle title — structural board heading (A2). */
  title: z.string(),
  rounds: z.array(
    z.object({
      id: z.string(),
      order: z.number().int(),
      label: z.string(),
      revealMode: z.enum(["SEQUENTIAL", "SIMULTANEOUS"]),
      /**
       * Allocations expanded to per-slot entries in reveal order:
       * allocation order (stored), then sequenceInAllocation asc — matching
       * E1-04's committed reveal order and slot identity (BR5 / A10).
       */
      slots: z.array(
        z.object({
          /** `<roundAllocationId>:<sequenceInAllocation>` via broadcast.ts slotId. */
          slotId: z.string(),
          prizeLabel: z.string(),
        })
      ),
    })
  ),
});

export type DisplayMeta = z.infer<typeof displayMetaSchema>;

/**
 * Builds the public display metadata for a raffle, or null when the raffle
 * does not exist. Server-only (touches Prisma). Selects ONLY structural
 * columns — no Entry or DrawEvent table is reachable from this query.
 */
export async function buildDisplayMeta(
  raffleId: string
): Promise<DisplayMeta | null> {
  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: {
      title: true,
      rounds: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          label: true,
          revealMode: true,
          allocations: {
            // Same stored allocation order the draw engine uses (draw.ts).
            orderBy: { id: "asc" },
            select: {
              id: true,
              quantity: true,
              prizeType: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!raffle) return null;

  // Parse through the schema so the returned object conforms by construction.
  return displayMetaSchema.parse({
    title: raffle.title,
    rounds: raffle.rounds.map((round) => ({
      id: round.id,
      order: round.order,
      label: round.label,
      revealMode: round.revealMode,
      slots: round.allocations.flatMap((allocation) =>
        Array.from({ length: allocation.quantity }, (_, i) => ({
          slotId: slotId(allocation.id, i + 1),
          prizeLabel: allocation.prizeType.name,
        }))
      ),
    })),
  });
}
