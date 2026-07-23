"use server";

import { revalidatePath } from "next/cache";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import { isStructureMutable } from "@/lib/lifecycle";
import { requireSession } from "@/lib/session";
import { prizeTypeSchema } from "@/lib/validation";

const PRIZE_TYPES_LOCKED_MESSAGE =
  "This raffle is locked. Prize types can no longer be changed.";

/**
 * Adds a prize type to a raffle (E1-01 Feature D). Name is required and must
 * be unique per raffle, case-insensitive (A-09 / D-E16). Status-gated against
 * a fresh DB read.
 */
export async function addPrizeType(
  raffleId: string,
  input: { name: string }
): Promise<ActionResult<{ id: string }>> {
  await requireSession();

  const parsed = prizeTypeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Prize type name is required.");
  }
  const name = parsed.data.name;

  try {
    const raffle = await db.raffle.findUnique({
      where: { id: raffleId },
      select: { status: true },
    });
    if (!raffle) {
      return fail("Raffle not found.");
    }
    if (!isStructureMutable(raffle.status)) {
      return fail(PRIZE_TYPES_LOCKED_MESSAGE);
    }

    // Case-insensitive uniqueness per raffle (D-E16); the DB unique on the
    // exact name is a backstop only.
    const duplicate = await db.prizeType.findFirst({
      where: { raffleId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      return fail("A prize type with this name already exists.");
    }

    const prizeType = await db.prizeType.create({
      data: { raffleId, name },
    });

    revalidatePath(`/raffles/${raffleId}`);
    return ok({ id: prizeType.id });
  } catch (err) {
    // DB unique backstop (race between the check and the insert).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return fail("A prize type with this name already exists.");
    }
    console.error("addPrizeType failed:", err);
    return fail("Could not save the change. Please retry.");
  }
}

export type DeletePrizeTypeData = {
  /** True when the prize type is allocated and the client must confirm the cascade. */
  requiresConfirmation: boolean;
  /** Number of round allocations that will be removed by a confirmed delete. */
  allocationCount: number;
};

/**
 * Deletes a prize type (E1-01 Feature D). Unallocated prize types delete
 * immediately. Allocated ones require confirmedCascade=true — the
 * confirmation must be explicit in the request, never assumed — and a
 * confirmed delete removes the prize type and its allocations in one
 * transaction. Status-gated against a fresh DB read.
 */
export async function deletePrizeType(
  prizeTypeId: string,
  confirmedCascade: boolean
): Promise<ActionResult<DeletePrizeTypeData>> {
  await requireSession();

  try {
    const prizeType = await db.prizeType.findUnique({
      where: { id: prizeTypeId },
      select: {
        raffleId: true,
        raffle: { select: { status: true } },
        _count: { select: { allocations: true } },
      },
    });
    if (!prizeType) {
      return fail("Prize type not found.");
    }
    if (!isStructureMutable(prizeType.raffle.status)) {
      return fail(PRIZE_TYPES_LOCKED_MESSAGE);
    }

    const allocationCount = prizeType._count.allocations;
    if (allocationCount > 0 && !confirmedCascade) {
      // Refuse: the client must (re)present the confirmation dialog.
      return ok({ requiresConfirmation: true, allocationCount });
    }

    // Prize type + dependent allocations removed atomically. The transaction
    // re-counts so a confirmation given against stale data still cascades
    // exactly what exists at delete time.
    await db.$transaction(async (tx) => {
      await tx.roundAllocation.deleteMany({ where: { prizeTypeId } });
      await tx.prizeType.delete({ where: { id: prizeTypeId } });
    });

    revalidatePath(`/raffles/${prizeType.raffleId}`);
    return ok({ requiresConfirmation: false, allocationCount: 0 });
  } catch (err) {
    console.error("deletePrizeType failed:", err);
    return fail("Could not save the change. Please retry.");
  }
}
