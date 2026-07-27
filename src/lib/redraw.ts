import type { DrawEventStatus, Prisma } from "@prisma/client";

import { getEligiblePool, type PoolEntry } from "@/lib/pool";
import { secureRandomIndex } from "@/lib/random";
import { writeAudit } from "@/lib/audit";

// THE redraw transaction body — shared by the post-draw redraw on the winners
// screen (E2-02 Feature 4.3) and the live redraw on the draw screen. Both
// paths do exactly the same three writes; only the eligibility gate in front
// of them differs, so there is one implementation of:
//   - the live pool (getEligiblePool, D-E01 semantics, recomputed INSIDE the
//     caller's transaction — never cached),
//   - the randomness (secureRandomIndex — crypto.getRandomValues only),
//   - the supersession pointer + its single audit entry.
//
// Callers own the transaction, the pre-flight guards, and the error strings.

/** No entrant remains eligible: the caller must abort with zero writes. */
export class EmptyPoolError extends Error {}
/** The original's FRESH persisted state no longer permits a redraw. */
export class RedrawStaleError extends Error {}

export type RedrawOriginal = {
  id: string;
  winnerEntryId: string;
  roundAllocationId: string;
  sequenceInAllocation: number;
};

export type RedrawOutcome = {
  replacementId: string;
  pick: PoolEntry;
};

/**
 * Replaces one slot's winner inside the caller's transaction.
 *
 * `eligibleStatuses` is re-checked against the persisted row in the same
 * conditional update that writes the supersession pointer, so a concurrent
 * status change rolls the whole transaction back rather than orphaning the
 * replacement.
 */
export async function applyRedraw(
  tx: Prisma.TransactionClient,
  args: {
    raffleId: string;
    original: RedrawOriginal;
    eligibleStatuses: DrawEventStatus[];
    reason: string;
    /**
     * Also move the original to RELEASED_TO_POOL, making that entrant eligible
     * again (the live-redraw semantics: the named winner simply was not there,
     * so they go back in the hat for later rounds and later redraws).
     *
     * Order matters and is guaranteed below: the replacement is picked from
     * the pool computed BEFORE this release, so a released entrant can never
     * be handed their own slot straight back.
     */
    releaseOriginal?: boolean;
  }
): Promise<RedrawOutcome> {
  const { raffleId, original, eligibleStatuses, reason, releaseOriginal } = args;

  // Pool recomputed LIVE inside the transaction via THE shared pool function
  // (D-E01 semantics) — never cached. Reads only; an empty pool aborts with
  // zero writes.
  const pool = await getEligiblePool(tx, raffleId);
  if (pool.length === 0) throw new EmptyPoolError();

  // THE shared randomness source — crypto.getRandomValues only.
  const pick = pool[secureRandomIndex(pool.length)];

  // (a) replacement event — same slot identity, fresh PENDING status.
  const replacement = await tx.drawEvent.create({
    data: {
      roundAllocationId: original.roundAllocationId,
      sequenceInAllocation: original.sequenceInAllocation,
      winnerEntryId: pick.id,
      status: "PENDING",
    },
    select: { id: true },
  });

  // (b) supersession pointer (+ the release, when the caller asked for it) —
  // the only fields ever written on the original, and only here. The
  // conditional update re-checks the FRESH persisted state (still eligible,
  // not already superseded); a concurrent change rolls the whole transaction
  // back, orphaning nothing.
  //
  // The pick above came from the pool as it stood BEFORE this write, so
  // releasing the original cannot make it eligible for its own replacement.
  const superseded = await tx.drawEvent.updateMany({
    where: {
      id: original.id,
      supersededById: null,
      status: { in: eligibleStatuses },
    },
    data: releaseOriginal
      ? { supersededById: replacement.id, status: "RELEASED_TO_POOL" }
      : { supersededById: replacement.id },
  });
  if (superseded.count !== 1) throw new RedrawStaleError();

  // (c) one audit entry capturing the supersession linkage and both winners —
  // the chain is reconstructible from the log alone (E3-01).
  await writeAudit(tx, {
    raffleId,
    entityType: "draw_event",
    entityId: replacement.id,
    drawEventId: replacement.id,
    action: "redraw",
    oldValue: {
      supersededFrom: original.id,
      previousWinner: original.winnerEntryId,
    },
    newValue: releaseOriginal
      ? { winnerEntryId: pick.id, previousWinnerStatus: "RELEASED_TO_POOL" }
      : { winnerEntryId: pick.id },
    reason,
    actor: "admin",
  });

  return { replacementId: replacement.id, pick };
}
