"use server";

import { revalidatePath } from "next/cache";
import type { RaffleStatus, RevealMode } from "@prisma/client";

import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { getEligiblePool, type PoolEntry } from "@/lib/pool";
import { secureRandomIndex } from "@/lib/random";
import { writeAudit } from "@/lib/audit";
import { isLegalTransition } from "@/lib/lifecycle";
import { slotId } from "@/lib/broadcast";
import { type ActionResult, ok, fail } from "@/lib/action-result";

// Fair Draw Engine (E1-04 Features 4.1–4.3).
//
// executeRound is the ONLY draw path in this epic:
//  - randomness: secureRandomIndex (crypto.getRandomValues, rejection-sampled;
//    the ONLY randomness source permitted in any draw path — PRD E1-04 AC1),
//  - pool: getEligiblePool, computed live at execution time (D-E01 semantics),
//  - all of a round's picks are computed up front in memory with draw-down
//    (no entrant wins twice in the round), then committed in ONE transaction
//    as PENDING DrawEvents + one AuditLog per event (D-E02), before any reveal,
//  - rounds are drawn strictly in configured order (D-E08),
//  - the raffle transitions LOCKED → DRAWN in the same transaction that
//    commits the FINAL round (D-E07); it stays LOCKED before that.

// ---------- Exported result shapes (consumed by the draw screen now, and by
// ---------- E2-01 display sync / E2-02 winner management later) ----------

export type DrawScreenSlot = {
  /** Stable slot identity: `<roundAllocationId>:<sequenceInAllocation>` (broadcast.ts slotId). */
  slotId: string;
  drawEventId: string;
  roundAllocationId: string;
  sequenceInAllocation: number;
  prizeLabel: string;
  winner: { fullName: string; ticketNumber: string };
};

export type DrawScreenAllocation = {
  id: string;
  prizeLabel: string;
  quantity: number;
};

export type DrawScreenRound = {
  id: string;
  order: number;
  label: string;
  revealMode: RevealMode;
  allocations: DrawScreenAllocation[];
  totalSlots: number;
  /** True when the round's DrawEvents are committed. */
  drawn: boolean;
  /** Committed slots in reveal order (allocation order, then seq asc); empty while undrawn. */
  slots: DrawScreenSlot[];
};

export type DrawScreenState = {
  raffleId: string;
  status: RaffleStatus;
  totalRounds: number;
  rounds: DrawScreenRound[];
  /** First undrawn round in configured order; null when every round is drawn. */
  nextRoundId: string | null;
};

export type ExecuteRoundResult = {
  roundId: string;
  revealMode: RevealMode;
  /** Committed slots in reveal order (allocation order, then seq asc). */
  slots: DrawScreenSlot[];
  /** True when this was the final round and the raffle is now DRAWN (D-E07). */
  raffleDrawn: boolean;
};

// ---------- Exact user-facing strings (FSD E1-04 §4.3 Error States) ----------

const NOT_READY = "This raffle is not ready to draw. It must be locked first.";
const ALREADY_DRAWN = "This round has already been drawn. Its results are shown below.";
const CANNOT_DRAW = "This round cannot be drawn.";
const START_FAILED =
  "The draw could not start due to a server error. No winners were selected. Please retry.";
const TX_FAILED =
  "The draw did not complete. No winners were committed for this round. Please retry.";

function exhaustionError(label: string): string {
  return `Draw stopped: the eligible pool ran out during round '${label}'. No winners were committed for this round. This should have been prevented at lock — contact support.`;
}

/** Internal sentinel: the in-transaction double-submit backstop fired. */
class AlreadyDrawnError extends Error {}

// ---------- Round execution ----------

export async function executeRound(
  roundId: string
): Promise<ActionResult<ExecuteRoundResult>> {
  await requireSession();

  // (2) Load round + allocations (stored order) + raffle status.
  const round = await db.drawRound.findUnique({
    where: { id: roundId },
    select: {
      id: true,
      raffleId: true,
      label: true,
      revealMode: true,
      raffle: { select: { status: true } },
      allocations: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantity: true,
          prizeType: { select: { name: true } },
        },
      },
    },
  });
  if (!round) return fail(CANNOT_DRAW);

  // Per D-E07 the raffle stays LOCKED until the final round commits, so every
  // drawable round implies status LOCKED. DRAWN means all rounds are committed.
  if (round.raffle.status !== "LOCKED") {
    return fail(round.raffle.status === "DRAWN" ? ALREADY_DRAWN : NOT_READY);
  }

  // (3) Strict configured order (D-E08) and no existing DrawEvents.
  const rounds = await db.drawRound.findMany({
    where: { raffleId: round.raffleId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      allocations: { select: { _count: { select: { drawEvents: true } } } },
    },
  });
  const isDrawn = (r: (typeof rounds)[number]) =>
    r.allocations.some((a) => a._count.drawEvents > 0);

  const target = rounds.find((r) => r.id === roundId);
  if (!target) return fail(CANNOT_DRAW);
  if (isDrawn(target)) return fail(ALREADY_DRAWN);
  const nextUndrawn = rounds.find((r) => !isDrawn(r));
  if (nextUndrawn?.id !== roundId) return fail(CANNOT_DRAW);
  const isFinal = rounds.every((r) => r.id === roundId || isDrawn(r));

  const totalQuantity = round.allocations.reduce((sum, a) => sum + a.quantity, 0);
  if (totalQuantity < 1) return fail(CANNOT_DRAW); // impossible post-lock; defensive

  // (4)–(5) Live pool + ALL picks computed up front in memory, with draw-down.
  type ComputedPick = {
    allocationId: string;
    prizeLabel: string;
    sequenceInAllocation: number;
    entry: PoolEntry;
  };
  let picks: ComputedPick[];
  try {
    const pool = await getEligiblePool(db, round.raffleId);
    // Defensive exhaustion guard BEFORE the transaction opens: zero writes.
    if (pool.length < totalQuantity) return fail(exhaustionError(round.label));

    const remaining = [...pool];
    picks = [];
    for (const allocation of round.allocations) {
      for (let seq = 1; seq <= allocation.quantity; seq++) {
        const idx = secureRandomIndex(remaining.length);
        const [entry] = remaining.splice(idx, 1); // draw-down: no double winner in-round
        picks.push({
          allocationId: allocation.id,
          prizeLabel: allocation.prizeType.name,
          sequenceInAllocation: seq,
          entry,
        });
      }
    }
  } catch {
    return fail(START_FAILED);
  }

  // (6) ONE transaction: DrawEvents (PENDING) + one AuditLog per event (D-E02),
  // plus the LOCKED → DRAWN transition when this is the final round (D-E07).
  const allocationIds = round.allocations.map((a) => a.id);
  try {
    const slots = await db.$transaction(
      async (tx) => {
        // Double-submit backstop: lock the round row so concurrent duplicate
        // executions serialize, then re-verify no DrawEvents exist. The loser
        // of the race sees the winner's committed rows and rolls back.
        await tx.$queryRaw`SELECT "id" FROM "DrawRound" WHERE "id" = ${round.id} FOR UPDATE`;
        const existing = await tx.drawEvent.count({
          where: { roundAllocationId: { in: allocationIds } },
        });
        if (existing > 0) throw new AlreadyDrawnError();

        const committed: DrawScreenSlot[] = [];
        for (const pick of picks) {
          const event = await tx.drawEvent.create({
            data: {
              roundAllocationId: pick.allocationId,
              sequenceInAllocation: pick.sequenceInAllocation,
              winnerEntryId: pick.entry.id,
              status: "PENDING",
            },
            select: { id: true },
          });
          await writeAudit(tx, {
            raffleId: round.raffleId,
            entityType: "draw_event",
            entityId: event.id,
            action: "draw",
            drawEventId: event.id,
            newValue: {
              winnerEntryId: pick.entry.id,
              ticketNumber: pick.entry.ticketNumber,
              roundAllocationId: pick.allocationId,
              sequenceInAllocation: pick.sequenceInAllocation,
            },
            actor: "admin",
          });
          committed.push({
            slotId: slotId(pick.allocationId, pick.sequenceInAllocation),
            drawEventId: event.id,
            roundAllocationId: pick.allocationId,
            sequenceInAllocation: pick.sequenceInAllocation,
            prizeLabel: pick.prizeLabel,
            winner: {
              fullName: pick.entry.fullName,
              ticketNumber: pick.entry.ticketNumber,
            },
          });
        }

        if (isFinal) {
          // D-E07: the raffle becomes DRAWN in the SAME transaction that
          // commits the final round. Re-read + legality check inside the tx.
          const current = await tx.raffle.findUniqueOrThrow({
            where: { id: round.raffleId },
            select: { status: true },
          });
          if (!isLegalTransition(current.status, "DRAWN")) {
            throw new Error(`Illegal transition ${current.status} -> DRAWN`);
          }
          await tx.raffle.update({
            where: { id: round.raffleId },
            data: { status: "DRAWN" },
          });
          await writeAudit(tx, {
            raffleId: round.raffleId,
            entityType: "raffle",
            entityId: round.raffleId,
            action: "draw",
            oldValue: { status: "LOCKED" },
            newValue: { status: "DRAWN" },
            actor: "admin",
          });
        }

        return committed;
      },
      { timeout: 15000 } // headroom for large rounds (≤ 50 slots, FSD NFR)
    );

    revalidatePath(`/raffles/${round.raffleId}/draw`);
    revalidatePath(`/raffles/${round.raffleId}`);
    return ok({
      roundId: round.id,
      revealMode: round.revealMode,
      slots,
      raffleDrawn: isFinal,
    });
  } catch (error) {
    if (error instanceof AlreadyDrawnError) return fail(ALREADY_DRAWN);
    // Transaction rolled back atomically: zero DrawEvents, zero audit rows.
    return fail(TX_FAILED);
  }
}

// ---------- Draw screen state (server-side query helper for the page) ----------

export async function getDrawScreenState(
  raffleId: string
): Promise<DrawScreenState | null> {
  await requireSession();

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: {
      id: true,
      status: true,
      rounds: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          label: true,
          revealMode: true,
          allocations: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              quantity: true,
              prizeType: { select: { name: true } },
              drawEvents: {
                orderBy: { sequenceInAllocation: "asc" },
                select: {
                  id: true,
                  sequenceInAllocation: true,
                  winnerEntry: { select: { fullName: true, ticketNumber: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!raffle) return null;

  const rounds: DrawScreenRound[] = raffle.rounds.map((r) => {
    // Reveal order: allocation order (stored), then sequenceInAllocation asc.
    const slots: DrawScreenSlot[] = r.allocations.flatMap((a) =>
      a.drawEvents.map((e) => ({
        slotId: slotId(a.id, e.sequenceInAllocation),
        drawEventId: e.id,
        roundAllocationId: a.id,
        sequenceInAllocation: e.sequenceInAllocation,
        prizeLabel: a.prizeType.name,
        winner: {
          fullName: e.winnerEntry.fullName,
          ticketNumber: e.winnerEntry.ticketNumber,
        },
      }))
    );
    return {
      id: r.id,
      order: r.order,
      label: r.label,
      revealMode: r.revealMode,
      allocations: r.allocations.map((a) => ({
        id: a.id,
        prizeLabel: a.prizeType.name,
        quantity: a.quantity,
      })),
      totalSlots: r.allocations.reduce((sum, a) => sum + a.quantity, 0),
      drawn: slots.length > 0,
      slots,
    };
  });

  return {
    raffleId: raffle.id,
    status: raffle.status,
    totalRounds: rounds.length,
    rounds,
    nextRoundId: rounds.find((r) => !r.drawn)?.id ?? null,
  };
}
