"use server";

import { revalidatePath } from "next/cache";
import type { DrawEventStatus, RaffleStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { applyRedraw, EmptyPoolError, RedrawStaleError } from "@/lib/redraw";
import { statusChangeSchema, redrawSchema } from "@/lib/validation";
import { slotId } from "@/lib/broadcast";
import { type ActionResult, ok, fail } from "@/lib/action-result";

// Winner Management & Audit Trail (E2-02 Features 4.1–4.4).
//
// Status transition matrix (D-E10, D-E11): the ONLY legal direct transitions
// are PENDING → CLAIMED | DISQUALIFIED | RELEASED_TO_POOL. CLAIMED is
// terminal; DISQUALIFIED / RELEASED_TO_POOL are terminal for direct status
// change — redraw (eligible on exactly those two statuses) is the only path
// onward. Everything else is rejected against the FRESH persisted status.
//
// Raffle gate (D-E18): status changes and redraws are permitted while the
// raffle is DRAWN and frozen at COMPLETED.
//
// Redraw reuses E1-04's foundations verbatim through the shared transaction
// body in src/lib/redraw.ts: getEligiblePool (D-E01 semantics, recomputed
// live inside the transaction) and secureRandomIndex (crypto.getRandomValues
// — the ONLY randomness source in any redraw path). The draw screen's LIVE
// redraw (redrawLiveSlot, src/actions/draw.ts) shares that same body; only
// the eligibility gate differs (PENDING while the show is running, vs the
// terminal statuses here).

// ---------- Exact user-facing strings (FSD E2-02 §4.2/4.3 Error States) ----------

const STALE_TRANSITION =
  "This winner's status has changed. The requested action is no longer available.";
const SUPERSEDED =
  "This record has been superseded by a redraw and can no longer be changed.";
const STATUS_TX_FAILED =
  "The status change could not be saved. No changes were made. Please retry.";
const REDRAW_INELIGIBLE = "Only disqualified or released slots can be redrawn.";
const POOL_EMPTY = "No eligible entrants remain for a redraw.";
const REDRAW_TX_FAILED =
  "The redraw could not be completed. No changes were made. Please retry.";
// D-E18 gate messages (no exact string in the FSD; polite rejection required).
const RAFFLE_FROZEN =
  "This raffle has been completed. Winner records are frozen and can no longer be changed.";
const RAFFLE_NOT_DRAWN =
  "Winner statuses can be changed once the raffle has been drawn.";

/** Internal sentinel for the status-change in-transaction guard. */
class StaleError extends Error {}

// ---------- Winners screen state (consumed by the winners page; the audit
// ---------- shapes here are also what E3-01's exports will read) ----------

export type WinnerAuditEntry = {
  id: string;
  /** The DrawEvent this entry is attached to (current event or a superseded predecessor). */
  drawEventId: string;
  /** True when the entry belongs to the row's current event; false → a superseded predecessor. */
  belongsToCurrent: boolean;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  actor: string;
  /** Server timestamp, ISO 8601. */
  createdAt: string;
};

export type WinnerChainEvent = {
  drawEventId: string;
  isCurrent: boolean;
  fullName: string;
  ticketNumber: string;
  /** Persisted status — for superseded events, frozen at supersession time. */
  status: DrawEventStatus;
  /** Server draw timestamp, ISO 8601. */
  createdAt: string;
};

export type WinnerRow = {
  /** The slot's CURRENT DrawEvent (supersededById null). */
  drawEventId: string;
  roundAllocationId: string;
  sequenceInAllocation: number;
  roundId: string;
  roundOrder: number;
  roundLabel: string;
  prizeName: string;
  fullName: string;
  ticketNumber: string;
  status: DrawEventStatus;
  /** Server draw timestamp of the current event, ISO 8601. */
  createdAt: string;
  /** Full supersession chain, origin first, current event last (length 1 when never redrawn). */
  chain: WinnerChainEvent[];
  /** AuditLog entries of the entire chain, chronological oldest-first. */
  history: WinnerAuditEntry[];
};

export type WinnersScreenState = {
  raffleId: string;
  raffleStatus: RaffleStatus;
  rounds: { id: string; order: number; label: string }[];
  /** One row per current (non-superseded) DrawEvent, in round/allocation/sequence order. */
  rows: WinnerRow[];
};

export async function getWinnersScreenState(
  raffleId: string
): Promise<WinnersScreenState | null> {
  await requireSession();

  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: {
      id: true,
      status: true,
      rounds: {
        orderBy: { order: "asc" },
        select: { id: true, order: true, label: true },
      },
    },
  });
  if (!raffle) return null;

  // Every DrawEvent of the raffle (current AND superseded) with its audit
  // entries — the chains are reassembled in memory below. Row counts are
  // bounded by slot count + supersessions (well under the 10k entrant cap).
  const events = await db.drawEvent.findMany({
    where: { roundAllocation: { round: { raffleId } } },
    select: {
      id: true,
      roundAllocationId: true,
      sequenceInAllocation: true,
      status: true,
      supersededById: true,
      createdAt: true,
      winnerEntry: { select: { fullName: true, ticketNumber: true } },
      roundAllocation: {
        select: {
          prizeType: { select: { name: true } },
          round: { select: { id: true, order: true, label: true } },
        },
      },
      auditLogs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          action: true,
          oldValue: true,
          newValue: true,
          reason: true,
          actor: true,
          createdAt: true,
        },
      },
    },
  });

  // original.supersededById points AT its replacement, so the predecessor of
  // event E is the event whose supersededById === E.id.
  const predecessorOf = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    if (e.supersededById) predecessorOf.set(e.supersededById, e);
  }

  const rows: WinnerRow[] = events
    .filter((e) => e.supersededById === null)
    .map((current) => {
      // Walk supersedes links back to the chain's origin.
      const chainNewestFirst = [current];
      let cursor = predecessorOf.get(current.id);
      while (cursor) {
        chainNewestFirst.push(cursor);
        cursor = predecessorOf.get(cursor.id);
      }
      const chainEvents = [...chainNewestFirst].reverse(); // origin first

      const chain: WinnerChainEvent[] = chainEvents.map((e) => ({
        drawEventId: e.id,
        isCurrent: e.id === current.id,
        fullName: e.winnerEntry.fullName,
        ticketNumber: e.winnerEntry.ticketNumber,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
      }));

      const history: WinnerAuditEntry[] = chainEvents
        .flatMap((e) =>
          e.auditLogs.map((log) => ({
            id: log.id,
            drawEventId: e.id,
            belongsToCurrent: e.id === current.id,
            action: log.action,
            oldValue: log.oldValue as unknown,
            newValue: log.newValue as unknown,
            reason: log.reason,
            actor: log.actor,
            createdAt: log.createdAt.toISOString(),
          }))
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      return {
        drawEventId: current.id,
        roundAllocationId: current.roundAllocationId,
        sequenceInAllocation: current.sequenceInAllocation,
        roundId: current.roundAllocation.round.id,
        roundOrder: current.roundAllocation.round.order,
        roundLabel: current.roundAllocation.round.label,
        prizeName: current.roundAllocation.prizeType.name,
        fullName: current.winnerEntry.fullName,
        ticketNumber: current.winnerEntry.ticketNumber,
        status: current.status,
        createdAt: current.createdAt.toISOString(),
        chain,
        history,
      };
    })
    .sort(
      (a, b) =>
        a.roundOrder - b.roundOrder ||
        a.roundAllocationId.localeCompare(b.roundAllocationId) ||
        a.sequenceInAllocation - b.sequenceInAllocation
    );

  return {
    raffleId: raffle.id,
    raffleStatus: raffle.status,
    rounds: raffle.rounds,
    rows,
  };
}

// ---------- Feature 4.2: status change with mandatory reason ----------

export type StatusChangeInput = {
  drawEventId: string;
  newStatus: "CLAIMED" | "DISQUALIFIED" | "RELEASED_TO_POOL";
  reason: string;
};

export async function changeDrawEventStatus(
  input: StatusChangeInput
): Promise<ActionResult<{ drawEventId: string; status: DrawEventStatus }>> {
  await requireSession();

  // Server-side Zod validation independent of the UI's disabled-button state:
  // empty/whitespace reason → "A reason is required for every status change."
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "A reason is required for every status change."
    );
  }
  const { drawEventId, newStatus, reason } = parsed.data; // reason is trimmed by the schema

  const event = await db.drawEvent.findUnique({
    where: { id: drawEventId },
    select: {
      id: true,
      status: true,
      supersededById: true,
      roundAllocation: {
        select: { round: { select: { raffleId: true, raffle: { select: { status: true } } } } },
      },
    },
  });
  if (!event) return fail(STALE_TRANSITION);

  const raffleId = event.roundAllocation.round.raffleId;
  const raffleStatus = event.roundAllocation.round.raffle.status;
  if (raffleStatus !== "DRAWN") {
    return fail(raffleStatus === "COMPLETED" ? RAFFLE_FROZEN : RAFFLE_NOT_DRAWN);
  }
  if (event.supersededById !== null) return fail(SUPERSEDED);
  // Legal direct transitions are exactly PENDING → CLAIMED | DISQUALIFIED |
  // RELEASED_TO_POOL (D-E10/D-E11); everything else rejected.
  if (event.status !== "PENDING") return fail(STALE_TRANSITION);

  try {
    await db.$transaction(async (tx) => {
      // ONE transaction, exactly two writes. The conditional update re-checks
      // the FRESH persisted status atomically: if a concurrent tab changed or
      // superseded the event since the read above, zero rows match and the
      // whole transaction rolls back with no partial state.
      const updated = await tx.drawEvent.updateMany({
        where: { id: drawEventId, status: "PENDING", supersededById: null },
        data: { status: newStatus }, // no other DrawEvent field is ever touched
      });
      if (updated.count !== 1) throw new StaleError();

      await writeAudit(tx, {
        raffleId,
        entityType: "draw_event",
        entityId: drawEventId,
        drawEventId,
        action: newStatus.toLowerCase() as
          | "claimed"
          | "disqualified"
          | "released_to_pool",
        oldValue: { status: "pending" },
        newValue: { status: newStatus.toLowerCase() },
        reason,
        actor: "admin",
      });
    });
  } catch (error) {
    if (error instanceof StaleError) return fail(STALE_TRANSITION);
    return fail(STATUS_TX_FAILED);
  }

  revalidatePath(`/raffles/${raffleId}/winners`);
  return ok({ drawEventId, status: newStatus });
}

// ---------- Feature 4.3: single-slot redraw via supersession ----------

export type RedrawInput = {
  drawEventId: string;
  reason: string;
};

export type RedrawResult = {
  /** Slot identity for the BroadcastChannel (broadcast.ts slotId helper). */
  slotId: string;
  replacement: {
    drawEventId: string;
    fullName: string;
    ticketNumber: string;
    status: DrawEventStatus;
  };
};

export async function redrawSlot(
  input: RedrawInput
): Promise<ActionResult<RedrawResult>> {
  await requireSession();

  const parsed = redrawSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "A reason is required for every status change."
    );
  }
  const { drawEventId, reason } = parsed.data;

  const original = await db.drawEvent.findUnique({
    where: { id: drawEventId },
    select: {
      id: true,
      status: true,
      supersededById: true,
      winnerEntryId: true,
      roundAllocationId: true,
      sequenceInAllocation: true,
      roundAllocation: {
        select: { round: { select: { raffleId: true, raffle: { select: { status: true } } } } },
      },
    },
  });
  if (!original) return fail(REDRAW_INELIGIBLE);

  const raffleId = original.roundAllocation.round.raffleId;
  const raffleStatus = original.roundAllocation.round.raffle.status;
  if (raffleStatus !== "DRAWN") {
    return fail(raffleStatus === "COMPLETED" ? RAFFLE_FROZEN : RAFFLE_NOT_DRAWN);
  }
  if (original.supersededById !== null) return fail(SUPERSEDED);
  // Defense in depth: the persisted status must be redraw-eligible regardless
  // of what the UI rendered (button never renders elsewhere).
  if (original.status !== "DISQUALIFIED" && original.status !== "RELEASED_TO_POOL") {
    return fail(REDRAW_INELIGIBLE);
  }

  try {
    // ONE transaction, exactly three writes — THE shared redraw body.
    const result = await db.$transaction(async (tx) =>
      applyRedraw(tx, {
        raffleId,
        original,
        eligibleStatuses: ["DISQUALIFIED", "RELEASED_TO_POOL"],
        reason,
      })
    );

    revalidatePath(`/raffles/${raffleId}/winners`);
    return ok({
      slotId: slotId(original.roundAllocationId, original.sequenceInAllocation),
      replacement: {
        drawEventId: result.replacementId,
        fullName: result.pick.fullName,
        ticketNumber: result.pick.ticketNumber,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (error instanceof EmptyPoolError) return fail(POOL_EMPTY);
    if (error instanceof RedrawStaleError) {
      // Concurrent state change (FSD 4.3 Alt 3): report the persisted reality.
      const fresh = await db.drawEvent.findUnique({
        where: { id: drawEventId },
        select: { status: true, supersededById: true },
      });
      if (fresh?.supersededById) return fail(SUPERSEDED);
      if (
        fresh &&
        fresh.status !== "DISQUALIFIED" &&
        fresh.status !== "RELEASED_TO_POOL"
      ) {
        return fail(REDRAW_INELIGIBLE);
      }
      return fail(REDRAW_TX_FAILED);
    }
    return fail(REDRAW_TX_FAILED);
  }
}
