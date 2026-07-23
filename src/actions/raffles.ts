"use server";

import type { RaffleStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isLegalTransition, isStructureMutable } from "@/lib/lifecycle";
import { requireSession } from "@/lib/session";
import { raffleSchema } from "@/lib/validation";

export type RaffleInput = {
  title: string;
  description?: string;
};

/** Creates a raffle in status DRAFT (E1-01 Feature C). */
export async function createRaffle(
  input: RaffleInput
): Promise<ActionResult<{ id: string }>> {
  await requireSession();

  const parsed = raffleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Title is required.");
  }

  try {
    const raffle = await db.raffle.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      },
    });
    revalidatePath("/raffles");
    return ok({ id: raffle.id });
  } catch (err) {
    console.error("createRaffle failed:", err);
    return fail("Could not save the raffle. Please retry.");
  }
}

/**
 * Updates title/description. Status-gated against a FRESH DB read: permitted
 * only while the raffle is DRAFT or OPEN (E1-01 Features C + E).
 */
export async function updateRaffle(
  raffleId: string,
  input: RaffleInput
): Promise<ActionResult<void>> {
  await requireSession();

  const parsed = raffleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Title is required.");
  }

  try {
    const raffle = await db.raffle.findUnique({
      where: { id: raffleId },
      select: { status: true },
    });
    if (!raffle) {
      return fail("Raffle not found.");
    }
    if (!isStructureMutable(raffle.status)) {
      return fail("This raffle is locked. Its details can no longer be edited.");
    }

    await db.raffle.update({
      where: { id: raffleId },
      data: {
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      },
    });

    revalidatePath("/raffles");
    revalidatePath(`/raffles/${raffleId}`);
    return ok(undefined);
  } catch (err) {
    console.error("updateRaffle failed:", err);
    return fail("Could not save the raffle. Please retry.");
  }
}

const AUDIT_ACTION: Record<RaffleStatus, "open" | "lock" | "draw" | "complete" | null> = {
  DRAFT: null, // no transition targets DRAFT
  OPEN: "open",
  LOCKED: "lock",
  DRAWN: "draw",
  COMPLETED: "complete",
};

/**
 * Lifecycle transition (E1-01 Feature E). Re-reads the current status from
 * the database inside the transaction — never trusts client-supplied state —
 * verifies the transition against LEGAL_TRANSITIONS, and writes exactly one
 * audit entry in the same transaction as the status change.
 */
export async function transitionRaffleStatus(
  raffleId: string,
  target: RaffleStatus
): Promise<ActionResult<{ status: RaffleStatus }>> {
  await requireSession();

  try {
    const result = await db.$transaction(async (tx) => {
      // Fresh read: enforcement is always against the persisted status.
      const raffle = await tx.raffle.findUnique({
        where: { id: raffleId },
        select: { status: true },
      });
      if (!raffle) {
        return fail<{ status: RaffleStatus }>("Raffle not found.");
      }

      const current = raffle.status;
      if (!isLegalTransition(current, target)) {
        return fail<{ status: RaffleStatus }>(
          `This raffle cannot move from ${current.toLowerCase()} to ${target.toLowerCase()}.`
        );
      }

      await tx.raffle.update({
        where: { id: raffleId },
        data: { status: target },
      });

      const action = AUDIT_ACTION[target];
      if (!action) {
        // Unreachable given LEGAL_TRANSITIONS, but never persist an
        // unaudited transition (Feature E Rule 4).
        throw new Error(`No audit action for transition target ${target}`);
      }
      await writeAudit(tx, {
        raffleId,
        entityType: "raffle",
        entityId: raffleId,
        action,
        oldValue: { status: current },
        newValue: { status: target },
      });

      return ok({ status: target });
    });

    if (result.ok) {
      revalidatePath("/raffles");
      revalidatePath(`/raffles/${raffleId}`);
    }
    return result;
  } catch (err) {
    console.error("transitionRaffleStatus failed:", err);
    return fail("Could not update the raffle status. Please retry.");
  }
}
