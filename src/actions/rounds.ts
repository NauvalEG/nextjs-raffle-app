"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { isStructureMutable } from "@/lib/lifecycle";
import { roundSchema } from "@/lib/validation";
import { type ActionResult, ok, fail } from "@/lib/action-result";

// Round Management Server Actions (E1-03 Feature A). Every mutation re-reads
// the raffle's persisted status and rejects when it is not DRAFT/OPEN — the UI
// disabling is a courtesy, not the enforcement (Feature A Rule 5).

const LOCKED_ROUNDS_MESSAGE =
  "This raffle is locked. Rounds and allocations can no longer be changed.";

function roundsPath(raffleId: string): string {
  return `/raffles/${raffleId}/rounds`;
}

export async function createRound(
  raffleId: string
): Promise<ActionResult<{ roundId: string }>> {
  await requireSession();

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: { status: true },
  });
  if (!raffle) return fail("Raffle not found.");
  if (!isStructureMutable(raffle.status)) return fail(LOCKED_ROUNDS_MESSAGE);

  const maxOrder = await db.drawRound.aggregate({
    _max: { order: true },
    where: { raffleId },
  });
  const order = (maxOrder._max.order ?? 0) + 1;

  const round = await db.drawRound.create({
    data: {
      raffleId,
      order,
      label: `Round ${order}`,
      revealMode: "SEQUENTIAL", // default per E1-03 A1
    },
  });

  revalidatePath(roundsPath(raffleId));
  return ok({ roundId: round.id });
}

export async function updateRound(
  roundId: string,
  input: { label: string; revealMode: "SEQUENTIAL" | "SIMULTANEOUS" }
): Promise<ActionResult> {
  await requireSession();

  const parsed = roundSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid round data.");
  }

  const round = await db.drawRound.findUnique({
    where: { id: roundId },
    select: { raffleId: true, raffle: { select: { status: true } } },
  });
  if (!round) return fail("That round no longer exists. Refresh the page.");
  if (!isStructureMutable(round.raffle.status)) return fail(LOCKED_ROUNDS_MESSAGE);

  await db.drawRound.update({
    where: { id: roundId },
    data: { label: parsed.data.label, revealMode: parsed.data.revealMode },
  });

  revalidatePath(roundsPath(round.raffleId));
  return ok(undefined);
}

export async function deleteRound(roundId: string): Promise<ActionResult> {
  await requireSession();

  const round = await db.drawRound.findUnique({
    where: { id: roundId },
    select: { raffleId: true, raffle: { select: { status: true } } },
  });
  if (!round) return fail("That round no longer exists. Refresh the page.");
  if (!isStructureMutable(round.raffle.status)) return fail(LOCKED_ROUNDS_MESSAGE);

  // Delete (allocations cascade via schema) and re-sequence the remaining
  // rounds contiguously 1..N in one transaction. The two-phase order update
  // (temporary negative values first) satisfies @@unique([raffleId, order]).
  try {
    await db.$transaction(async (tx) => {
      const current = await tx.raffle.findUnique({
        where: { id: round.raffleId },
        select: { status: true },
      });
      if (!current || !isStructureMutable(current.status)) {
        throw new Error("LOCKED");
      }

      await tx.drawRound.delete({ where: { id: roundId } });

      const remaining = await tx.drawRound.findMany({
        where: { raffleId: round.raffleId },
        orderBy: { order: "asc" },
        select: { id: true },
      });

      for (let i = 0; i < remaining.length; i++) {
        await tx.drawRound.update({
          where: { id: remaining[i].id },
          data: { order: -(i + 1) },
        });
      }
      for (let i = 0; i < remaining.length; i++) {
        await tx.drawRound.update({
          where: { id: remaining[i].id },
          data: { order: i + 1 },
        });
      }
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "LOCKED") {
      return fail(LOCKED_ROUNDS_MESSAGE);
    }
    return fail("Could not delete the round. Please try again.");
  }

  revalidatePath(roundsPath(round.raffleId));
  return ok(undefined);
}

export async function reorderRounds(
  raffleId: string,
  orderedRoundIds: string[]
): Promise<ActionResult> {
  await requireSession();

  if (orderedRoundIds.length === 0) return fail("Nothing to reorder.");

  try {
    await db.$transaction(async (tx) => {
      const raffle = await tx.raffle.findUnique({
        where: { id: raffleId },
        select: { status: true },
      });
      if (!raffle) throw new Error("NOT_FOUND");
      if (!isStructureMutable(raffle.status)) throw new Error("LOCKED");

      const rounds = await tx.drawRound.findMany({
        where: { raffleId },
        select: { id: true },
      });

      // The submitted id set must match the raffle's rounds exactly — no
      // omissions, no extras, no duplicates.
      const existing = new Set(rounds.map((r) => r.id));
      const submitted = new Set(orderedRoundIds);
      if (
        submitted.size !== orderedRoundIds.length ||
        existing.size !== submitted.size ||
        [...existing].some((id) => !submitted.has(id))
      ) {
        throw new Error("MISMATCH");
      }

      // Two-phase reassignment to satisfy @@unique([raffleId, order]):
      // phase 1 parks every round on a temporary negative order, phase 2
      // assigns the final contiguous 1..N.
      for (let i = 0; i < orderedRoundIds.length; i++) {
        await tx.drawRound.update({
          where: { id: orderedRoundIds[i] },
          data: { order: -(i + 1) },
        });
      }
      for (let i = 0; i < orderedRoundIds.length; i++) {
        await tx.drawRound.update({
          where: { id: orderedRoundIds[i] },
          data: { order: i + 1 },
        });
      }
    });
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.message === "LOCKED") return fail(LOCKED_ROUNDS_MESSAGE);
      if (e.message === "NOT_FOUND") return fail("Raffle not found.");
      if (e.message === "MISMATCH") {
        return fail(
          "Could not save the new round order. The previous order has been restored — please try again."
        );
      }
    }
    return fail(
      "Could not save the new round order. The previous order has been restored — please try again."
    );
  }

  revalidatePath(roundsPath(raffleId));
  return ok(undefined);
}
