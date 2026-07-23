"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { getAllocationSummary } from "@/lib/allocation";
import { type ActionResult, ok, fail } from "@/lib/action-result";

// Lock Raffle with server-side validation (E1-03 Feature D). The validation
// and the status transition run in ONE transaction: no window exists in which
// the raffle is locked but was never validated (Feature D Rule 4). The
// numbers in the failure message are computed server-side inside the same
// transaction — client state is never trusted.

export async function lockRaffle(raffleId: string): Promise<ActionResult> {
  await requireSession();

  let result: ActionResult;
  try {
    result = await db.$transaction(async (tx) => {
      // (a) Re-read the persisted status; lock is permitted only from
      // DRAFT or OPEN (D-E06).
      const raffle = await tx.raffle.findUnique({
        where: { id: raffleId },
        select: { status: true },
      });
      if (!raffle) return fail("Raffle not found.");
      if (raffle.status === "LOCKED") {
        return fail("This raffle is already locked.");
      }
      if (raffle.status === "DRAWN" || raffle.status === "COMPLETED") {
        return fail("This raffle can no longer be locked from its current state.");
      }

      // (b) The SAME shared computation the live counter uses (Feature C
      // Rule 3), executed inside the transaction.
      const [{ totalPlanned, entryCount }, roundCount] = await Promise.all([
        getAllocationSummary(tx, raffleId),
        tx.drawRound.count({ where: { raffleId } }),
      ]);

      // (c) Zero-round / zero-draw plans are refused (E1-03 A6 / D-E06).
      if (roundCount === 0 || totalPlanned === 0) {
        return fail("Add at least one round with a prize allocation before locking.");
      }
      if (totalPlanned > entryCount) {
        return fail(
          `This raffle plans ${totalPlanned} draws across all rounds but only has ${entryCount} entrants. Reduce allocations or add entrants before locking.`
        );
      }

      // (d) Transition + exactly one audit entry, atomically.
      await tx.raffle.update({
        where: { id: raffleId },
        data: { status: "LOCKED" },
      });
      await writeAudit(tx, {
        raffleId,
        entityType: "raffle",
        entityId: raffleId,
        action: "lock",
        oldValue: { status: raffle.status },
        newValue: { status: "LOCKED" },
      });

      return ok(undefined);
    });
  } catch {
    return fail("Locking failed — the raffle was not locked. Please try again.");
  }

  if (result.ok) {
    revalidatePath(`/raffles/${raffleId}/rounds`);
    revalidatePath(`/raffles/${raffleId}`);
  }
  return result;
}
