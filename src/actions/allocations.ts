"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { isStructureMutable } from "@/lib/lifecycle";
import { allocationSchema } from "@/lib/validation";
import { type ActionResult, ok, fail } from "@/lib/action-result";

// Allocation Management Server Actions (E1-03 Feature B). Duplicate
// (round, prizeType) rows are allowed and never merged (D-E17). Over-allocation
// is permitted while editing — it is surfaced by the counter and blocked only
// at lock (Feature B Rule 5).

const LOCKED_ROUNDS_MESSAGE =
  "This raffle is locked. Rounds and allocations can no longer be changed.";
const PRIZE_TYPE_GONE_MESSAGE =
  "That prize type no longer exists. Refresh the page and pick another.";

function roundsPath(raffleId: string): string {
  return `/raffles/${raffleId}/rounds`;
}

export async function createAllocation(
  roundId: string,
  input: { prizeTypeId: string; quantity: number }
): Promise<ActionResult<{ allocationId: string }>> {
  await requireSession();

  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid allocation.");
  }

  const round = await db.drawRound.findUnique({
    where: { id: roundId },
    select: { raffleId: true, raffle: { select: { status: true } } },
  });
  if (!round) return fail("That round no longer exists. Refresh the page.");
  if (!isStructureMutable(round.raffle.status)) return fail(LOCKED_ROUNDS_MESSAGE);

  // The prize type must belong to the same raffle as the round (Feature B
  // Rule 3); a stale/foreign/deleted id gets the refresh message.
  const prizeType = await db.prizeType.findUnique({
    where: { id: parsed.data.prizeTypeId },
    select: { raffleId: true },
  });
  if (!prizeType || prizeType.raffleId !== round.raffleId) {
    return fail(PRIZE_TYPE_GONE_MESSAGE);
  }

  try {
    const allocation = await db.roundAllocation.create({
      data: {
        roundId,
        prizeTypeId: parsed.data.prizeTypeId,
        quantity: parsed.data.quantity,
      },
    });
    revalidatePath(roundsPath(round.raffleId));
    return ok({ allocationId: allocation.id });
  } catch {
    // FK failure — the prize type (or round) vanished between check and write.
    return fail(PRIZE_TYPE_GONE_MESSAGE);
  }
}

export async function updateAllocation(
  allocationId: string,
  input: { quantity: number }
): Promise<ActionResult> {
  await requireSession();

  const parsedQuantity = allocationSchema.shape.quantity.safeParse(input.quantity);
  if (!parsedQuantity.success) {
    return fail(
      parsedQuantity.error.issues[0]?.message ??
        "Quantity must be a whole number of at least 1."
    );
  }

  const allocation = await db.roundAllocation.findUnique({
    where: { id: allocationId },
    select: {
      round: { select: { raffleId: true, raffle: { select: { status: true } } } },
    },
  });
  if (!allocation) {
    return fail("That allocation no longer exists. Refresh the page.");
  }
  if (!isStructureMutable(allocation.round.raffle.status)) {
    return fail(LOCKED_ROUNDS_MESSAGE);
  }

  await db.roundAllocation.update({
    where: { id: allocationId },
    data: { quantity: parsedQuantity.data },
  });

  revalidatePath(roundsPath(allocation.round.raffleId));
  return ok(undefined);
}

export async function deleteAllocation(allocationId: string): Promise<ActionResult> {
  await requireSession();

  const allocation = await db.roundAllocation.findUnique({
    where: { id: allocationId },
    select: {
      round: { select: { raffleId: true, raffle: { select: { status: true } } } },
    },
  });
  if (!allocation) {
    return fail("That allocation no longer exists. Refresh the page.");
  }
  if (!isStructureMutable(allocation.round.raffle.status)) {
    return fail(LOCKED_ROUNDS_MESSAGE);
  }

  await db.roundAllocation.delete({ where: { id: allocationId } });

  revalidatePath(roundsPath(allocation.round.raffleId));
  return ok(undefined);
}
