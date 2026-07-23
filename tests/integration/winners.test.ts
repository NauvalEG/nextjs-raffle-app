// Integration: winner management (src/actions/winners.ts) against the real
// Neon database — status transition matrix (D-E10/D-E11), 2-write status
// transactions, redraw supersession, raffle gating (D-E18), audit completeness.

import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test" }), set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireSession: async () => {},
  hasValidSession: async () => true,
}));

import { changeDrawEventStatus, redrawSlot } from "@/actions/winners";
import { executeRound } from "@/actions/draw";
import { lockRaffle } from "@/actions/lock";
import { transitionRaffleStatus } from "@/actions/raffles";
import { db } from "@/lib/db";
import type { DrawEvent } from "@prisma/client";
import {
  raffleTracker,
  uniqueTitle,
  expectOk,
  expectFail,
  seedStructure,
  drawEventsOf,
  auditRowsOf,
  type SeedResult,
} from "./helpers";

const tracker = raffleTracker();
afterAll(() => tracker.cleanup());

const STALE = "This winner's status has changed. The requested action is no longer available.";
const SUPERSEDED = "This record has been superseded by a redraw and can no longer be changed.";
const REDRAW_INELIGIBLE = "Only disqualified or released slots can be redrawn.";
const POOL_EMPTY = "No eligible entrants remain for a redraw.";
const FROZEN =
  "This raffle has been completed. Winner records are frozen and can no longer be changed.";
const NOT_DRAWN = "Winner statuses can be changed once the raffle has been drawn.";

/** Locks + draws a single-round raffle, returning the seed and its pending events. */
async function seedDrawnRaffle(entrants: number, slots: number, prefix = "it-win") {
  const seed = await seedStructure({
    title: uniqueTitle(prefix),
    entrantCount: entrants,
    rounds: [{ label: "Round 1", allocations: [{ prize: "Prize", quantity: slots }] }],
  });
  tracker.track(seed.raffleId);
  expectOk(await lockRaffle(seed.raffleId));
  expectOk(await executeRound(seed.rounds[0].id));
  const events = await drawEventsOf(seed.raffleId);
  return { seed, events };
}

function fullRow(id: string): Promise<DrawEvent> {
  return db.drawEvent.findUniqueOrThrow({ where: { id } });
}

describe("changeDrawEventStatus", () => {
  let seed: SeedResult;
  let events: DrawEvent[]; // 4 pending slots, 3 entrants left in the pool

  beforeAll(async () => {
    ({ seed, events } = await seedDrawnRaffle(7, 4));
    expect(events).toHaveLength(4);
  });

  it("rejects a whitespace-only reason at schema level with zero writes", async () => {
    const target = events[0];
    const auditCountBefore = (await auditRowsOf(seed.raffleId)).length;

    const error = expectFail(
      await changeDrawEventStatus({
        drawEventId: target.id,
        newStatus: "CLAIMED",
        reason: "   ",
      })
    );
    expect(error).toBe("A reason is required for every status change.");

    expect(await fullRow(target.id)).toEqual(target); // untouched
    expect((await auditRowsOf(seed.raffleId)).length).toBe(auditCountBefore);
  });

  const cases = [
    { newStatus: "CLAIMED", action: "claimed", index: 0 },
    { newStatus: "DISQUALIFIED", action: "disqualified", index: 1 },
    { newStatus: "RELEASED_TO_POOL", action: "released_to_pool", index: 2 },
  ] as const;

  for (const c of cases) {
    it(`PENDING -> ${c.newStatus}: exactly the 2-write transaction, no other field mutated`, async () => {
      const before = await fullRow(events[c.index].id);
      expect(before.status).toBe("PENDING");
      const auditBefore = await auditRowsOf(seed.raffleId);

      const data = expectOk(
        await changeDrawEventStatus({
          drawEventId: before.id,
          newStatus: c.newStatus,
          reason: `  Reason for ${c.action}  `, // trimmed by the schema
        })
      );
      expect(data).toEqual({ drawEventId: before.id, status: c.newStatus });

      // Write 1: status is the ONLY DrawEvent field that changed.
      const after = await fullRow(before.id);
      expect(after).toEqual({ ...before, status: c.newStatus });

      // Write 2: exactly ONE new audit entry with the specified shape.
      const auditAfter = await auditRowsOf(seed.raffleId);
      expect(auditAfter.length).toBe(auditBefore.length + 1);
      const entry = auditAfter[auditAfter.length - 1];
      expect(entry.action).toBe(c.action);
      expect(entry.entityType).toBe("draw_event");
      expect(entry.entityId).toBe(before.id);
      expect(entry.drawEventId).toBe(before.id);
      expect(entry.oldValue).toEqual({ status: "pending" });
      expect(entry.newValue).toEqual({ status: c.action });
      expect(entry.reason).toBe(`Reason for ${c.action}`);
      expect(entry.actor).toBe("admin");
    });
  }

  it("rejects transitions out of terminal statuses (CLAIMED is terminal)", async () => {
    const claimed = events[0]; // now CLAIMED
    const error = expectFail(
      await changeDrawEventStatus({
        drawEventId: claimed.id,
        newStatus: "DISQUALIFIED",
        reason: "changed my mind",
      })
    );
    expect(error).toBe(STALE);
    expect((await fullRow(claimed.id)).status).toBe("CLAIMED");
  });

  it("rejects redraw on PENDING and on CLAIMED slots with zero writes", async () => {
    const pending = events[3]; // still PENDING
    const claimed = events[0]; // CLAIMED
    const eventCountBefore = (await drawEventsOf(seed.raffleId)).length;
    const auditCountBefore = (await auditRowsOf(seed.raffleId)).length;

    expect(
      expectFail(await redrawSlot({ drawEventId: pending.id, reason: "why not" }))
    ).toBe(REDRAW_INELIGIBLE);
    expect(
      expectFail(await redrawSlot({ drawEventId: claimed.id, reason: "why not" }))
    ).toBe(REDRAW_INELIGIBLE);

    expect((await drawEventsOf(seed.raffleId)).length).toBe(eventCountBefore);
    expect((await auditRowsOf(seed.raffleId)).length).toBe(auditCountBefore);
  });

  it("redrawSlot on a DISQUALIFIED slot: replacement + supersession + one audit entry in one transaction", async () => {
    const original = await fullRow(events[1].id); // DISQUALIFIED above
    expect(original.status).toBe("DISQUALIFIED");
    const auditBefore = await auditRowsOf(seed.raffleId);

    // Eligible at this moment: the 3 never-drawn entrants + the released
    // winner (events[2]); excluded: pending/claimed winners + the
    // disqualified original's winner.
    const winners = new Set(events.map((e) => e.winnerEntryId));
    const released = events[2].winnerEntryId;
    const allEntries = seed.entries.map((e) => e.id);
    const eligible = new Set(
      allEntries.filter((id) => !winners.has(id) || id === released)
    );

    const data = expectOk(
      await redrawSlot({ drawEventId: original.id, reason: "  Redraw reason  " })
    );
    expect(data.slotId).toBe(
      `${original.roundAllocationId}:${original.sequenceInAllocation}`
    );
    expect(data.replacement.status).toBe("PENDING");

    // Replacement: same slot identity, PENDING, winner from the live pool.
    const replacement = await fullRow(data.replacement.drawEventId);
    expect(replacement.roundAllocationId).toBe(original.roundAllocationId);
    expect(replacement.sequenceInAllocation).toBe(original.sequenceInAllocation);
    expect(replacement.status).toBe("PENDING");
    expect(replacement.supersededById).toBeNull();
    expect(eligible.has(replacement.winnerEntryId)).toBe(true);
    expect(replacement.winnerEntryId).not.toBe(original.winnerEntryId);

    // Original: supersededById is the ONLY field that changed (full-row compare).
    const originalAfter = await fullRow(original.id);
    expect(originalAfter).toEqual({ ...original, supersededById: replacement.id });

    // Exactly ONE new audit entry, action "redraw", with the linkage payload.
    const auditAfter = await auditRowsOf(seed.raffleId);
    expect(auditAfter.length).toBe(auditBefore.length + 1);
    const entry = auditAfter[auditAfter.length - 1];
    expect(entry.action).toBe("redraw");
    expect(entry.entityType).toBe("draw_event");
    expect(entry.entityId).toBe(replacement.id);
    expect(entry.drawEventId).toBe(replacement.id);
    expect(entry.oldValue).toEqual({
      supersededFrom: original.id,
      previousWinner: original.winnerEntryId,
    });
    expect(entry.newValue).toEqual({ winnerEntryId: replacement.winnerEntryId });
    expect(entry.reason).toBe("Redraw reason");
    expect(entry.actor).toBe("admin");
  });

  it("rejects redraw and status change on an already-superseded event", async () => {
    const superseded = await fullRow(events[1].id);
    expect(superseded.supersededById).not.toBeNull();

    expect(
      expectFail(await redrawSlot({ drawEventId: superseded.id, reason: "again" }))
    ).toBe(SUPERSEDED);
    expect(
      expectFail(
        await changeDrawEventStatus({
          drawEventId: superseded.id,
          newStatus: "CLAIMED",
          reason: "late claim",
        })
      )
    ).toBe(SUPERSEDED);
  });
});

describe("raffle status gating (D-E18)", () => {
  it("rejects status changes/redraws while LOCKED, and freezes them at COMPLETED", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-win-gate"),
      entrantCount: 3,
      rounds: [
        { label: "Round 1", allocations: [{ prize: "P", quantity: 1 }] },
        { label: "Round 2", allocations: [{ prize: "P", quantity: 1 }] },
      ],
    });
    tracker.track(seed.raffleId);
    expectOk(await lockRaffle(seed.raffleId));

    // Round 1 drawn, round 2 not -> raffle still LOCKED with a real event.
    expectOk(await executeRound(seed.rounds[0].id));
    const [event] = await drawEventsOf(seed.raffleId);
    expect(
      (await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } })).status
    ).toBe("LOCKED");

    expect(
      expectFail(
        await changeDrawEventStatus({
          drawEventId: event.id,
          newStatus: "CLAIMED",
          reason: "too early",
        })
      )
    ).toBe(NOT_DRAWN);
    expect(
      expectFail(await redrawSlot({ drawEventId: event.id, reason: "too early" }))
    ).toBe(NOT_DRAWN);

    // Finish the draw, complete the raffle -> frozen.
    expectOk(await executeRound(seed.rounds[1].id));
    expectOk(await transitionRaffleStatus(seed.raffleId, "COMPLETED"));

    expect(
      expectFail(
        await changeDrawEventStatus({
          drawEventId: event.id,
          newStatus: "CLAIMED",
          reason: "too late",
        })
      )
    ).toBe(FROZEN);
    expect(
      expectFail(await redrawSlot({ drawEventId: event.id, reason: "too late" }))
    ).toBe(FROZEN);

    expect((await fullRow(event.id)).status).toBe("PENDING");
  });
});

describe("redraw pool determinism", () => {
  it("empty-pool redraw is refused with zero writes; an interim release makes that entrant selectable", async () => {
    // 2 entrants, 2 slots -> after the draw the pool is empty by construction.
    const { seed, events } = await seedDrawnRaffle(2, 2, "it-win-pool");
    const [evA, evB] = events;

    // Disqualify B's slot: pool still empty (A pending, B disqualified).
    expectOk(
      await changeDrawEventStatus({
        drawEventId: evB.id,
        newStatus: "DISQUALIFIED",
        reason: "ineligible",
      })
    );

    const eventCountBefore = (await drawEventsOf(seed.raffleId)).length;
    const auditCountBefore = (await auditRowsOf(seed.raffleId)).length;
    expect(
      expectFail(await redrawSlot({ drawEventId: evB.id, reason: "try" }))
    ).toBe(POOL_EMPTY);
    expect((await drawEventsOf(seed.raffleId)).length).toBe(eventCountBefore);
    expect((await auditRowsOf(seed.raffleId)).length).toBe(auditCountBefore);
    expect(
      (await db.drawEvent.findUniqueOrThrow({ where: { id: evB.id } })).supersededById
    ).toBeNull();

    // Interim release: entrant A re-enters the pool and MUST be the pick.
    expectOk(
      await changeDrawEventStatus({
        drawEventId: evA.id,
        newStatus: "RELEASED_TO_POOL",
        reason: "released back",
      })
    );

    const data = expectOk(await redrawSlot({ drawEventId: evB.id, reason: "retry" }));
    const replacement = await db.drawEvent.findUniqueOrThrow({
      where: { id: data.replacement.drawEventId },
    });
    expect(replacement.winnerEntryId).toBe(evA.winnerEntryId); // the released entrant
    expect(replacement.status).toBe("PENDING");
  });
});

describe("audit completeness (PRD success metric)", () => {
  it("draw -> disqualify -> redraw -> claim yields exactly one audit entry per consequential action", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-win-audit"),
      entrantCount: 3,
      rounds: [{ label: "Round 1", allocations: [{ prize: "P", quantity: 1 }] }],
    });
    tracker.track(seed.raffleId);

    expectOk(await lockRaffle(seed.raffleId));
    expectOk(await executeRound(seed.rounds[0].id)); // final round -> DRAWN
    const [original] = await drawEventsOf(seed.raffleId);

    expectOk(
      await changeDrawEventStatus({
        drawEventId: original.id,
        newStatus: "DISQUALIFIED",
        reason: "rule violation",
      })
    );
    const redraw = expectOk(
      await redrawSlot({ drawEventId: original.id, reason: "replace winner" })
    );
    expectOk(
      await changeDrawEventStatus({
        drawEventId: redraw.replacement.drawEventId,
        newStatus: "CLAIMED",
        reason: "picked up on stage",
      })
    );

    const audits = await auditRowsOf(seed.raffleId);
    const byAction = new Map<string, number>();
    for (const a of audits) byAction.set(a.action, (byAction.get(a.action) ?? 0) + 1);

    expect(byAction.get("lock")).toBe(1);
    expect(byAction.get("draw")).toBe(2); // 1 per DrawEvent + 1 raffle-level DRAWN
    expect(byAction.get("disqualified")).toBe(1);
    expect(byAction.get("redraw")).toBe(1);
    expect(byAction.get("claimed")).toBe(1);
    expect(audits).toHaveLength(6);
  });
});
