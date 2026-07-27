// Integration: fair draw engine (src/actions/draw.ts + src/lib/pool.ts)
// against the real Neon database — commit shapes, ordering, exhaustion,
// pool semantics (D-E01) and double-submit concurrency.

import { describe, it, expect, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test" }), set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireSession: async () => {},
  hasValidSession: async () => true,
}));

import { executeRound, getDrawScreenState, redrawLiveSlot } from "@/actions/draw";
import { lockRaffle } from "@/actions/lock";
import { transitionRaffleStatus } from "@/actions/raffles";
import { getEligiblePool } from "@/lib/pool";
import { db } from "@/lib/db";
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

const ALREADY_DRAWN = "This round has already been drawn. Its results are shown below.";

/** Full draw fixture: 2 rounds (SEQUENTIAL 1xA, SIMULTANEOUS 3xB), locked via the real action. */
async function seedLockedTwoRoundRaffle(entrants = 8): Promise<SeedResult> {
  const seed = await seedStructure({
    title: uniqueTitle("it-draw"),
    entrantCount: entrants,
    rounds: [
      { label: "Round 1", revealMode: "SEQUENTIAL", allocations: [{ prize: "A", quantity: 1 }] },
      { label: "Round 2", revealMode: "SIMULTANEOUS", allocations: [{ prize: "B", quantity: 3 }] },
    ],
  });
  tracker.track(seed.raffleId);
  expectOk(await lockRaffle(seed.raffleId), "lockRaffle for draw seed");
  return seed;
}

describe("executeRound", () => {
  // One shared fixture drives the happy path + re-execution checks in order.
  let seed: SeedResult;

  it("round 1: commits exactly the allocated PENDING DrawEvents with one 'draw' audit each; raffle stays LOCKED", async () => {
    seed = await seedLockedTwoRoundRaffle();
    const [round1] = seed.rounds;

    const result = expectOk(await executeRound(round1.id));
    expect(result.roundId).toBe(round1.id);
    expect(result.revealMode).toBe("SEQUENTIAL");
    expect(result.raffleDrawn).toBe(false);
    expect(result.slots).toHaveLength(1);

    const events = await drawEventsOf(seed.raffleId);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("PENDING");
    expect(events[0].roundAllocationId).toBe(round1.allocationIds[0]);
    expect(events[0].sequenceInAllocation).toBe(1);
    expect(events[0].supersededById).toBeNull();

    // One audit entry per DrawEvent (D-E02), none at raffle level yet.
    const drawAudits = await db.auditLog.findMany({
      where: { raffleId: seed.raffleId, action: "draw" },
    });
    expect(drawAudits.filter((a) => a.entityType === "draw_event")).toHaveLength(1);
    expect(drawAudits.filter((a) => a.entityType === "raffle")).toHaveLength(0);
    expect(drawAudits[0].drawEventId).toBe(events[0].id);

    const raffle = await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } });
    expect(raffle.status).toBe("LOCKED"); // not the final round (D-E07)
  });

  it("round 2 (final): commits all slots, winners distinct across BOTH rounds, raffle DRAWN with a raffle-level audit entry", async () => {
    const [, round2] = seed.rounds;

    const result = expectOk(await executeRound(round2.id));
    expect(result.raffleDrawn).toBe(true);
    expect(result.slots).toHaveLength(3);

    const events = await drawEventsOf(seed.raffleId);
    expect(events).toHaveLength(4);
    // Draw-down + live pool exclusion: 4 distinct winning entrants.
    expect(new Set(events.map((e) => e.winnerEntryId)).size).toBe(4);

    // Round 2 events carry sequence 1..3 on the round's single allocation.
    const round2Events = events.filter(
      (e) => e.roundAllocationId === round2.allocationIds[0]
    );
    expect(round2Events.map((e) => e.sequenceInAllocation).sort()).toEqual([1, 2, 3]);
    expect(round2Events.every((e) => e.status === "PENDING")).toBe(true);

    const raffle = await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } });
    expect(raffle.status).toBe("DRAWN"); // D-E07

    const drawAudits = await db.auditLog.findMany({
      where: { raffleId: seed.raffleId, action: "draw" },
    });
    expect(drawAudits.filter((a) => a.entityType === "draw_event")).toHaveLength(4);
    const raffleLevel = drawAudits.filter((a) => a.entityType === "raffle");
    expect(raffleLevel).toHaveLength(1);
    expect(raffleLevel[0].oldValue).toEqual({ status: "LOCKED" });
    expect(raffleLevel[0].newValue).toEqual({ status: "DRAWN" });
  });

  it("re-executing an already-drawn round is rejected with zero new events", async () => {
    const before = (await drawEventsOf(seed.raffleId)).length;

    expect(expectFail(await executeRound(seed.rounds[0].id))).toBe(ALREADY_DRAWN);

    expect((await drawEventsOf(seed.raffleId)).length).toBe(before);
  });

  it("rejects executing rounds out of configured order", async () => {
    const fresh = await seedLockedTwoRoundRaffle(5);

    const error = expectFail(await executeRound(fresh.rounds[1].id));
    expect(error).toBe("This round cannot be drawn.");
    expect(await drawEventsOf(fresh.raffleId)).toHaveLength(0);
  });

  it("rejects drawing an unlocked raffle", async () => {
    const unlocked = await seedStructure({
      title: uniqueTitle("it-draw-unlocked"),
      entrantCount: 3,
      rounds: [{ allocations: [{ prize: "A", quantity: 1 }] }],
    });
    tracker.track(unlocked.raffleId);

    const error = expectFail(await executeRound(unlocked.rounds[0].id));
    expect(error).toBe("This raffle is not ready to draw. It must be locked first.");
    expect(await drawEventsOf(unlocked.raffleId)).toHaveLength(0);
  });

  it("defensive exhaustion: pool smaller than the allocation errors with ZERO DrawEvents persisted", async () => {
    const seedEx = await seedStructure({
      title: uniqueTitle("it-draw-exhaust"),
      entrantCount: 3,
      rounds: [{ label: "Round 1", allocations: [{ prize: "A", quantity: 3 }] }],
    });
    tracker.track(seedEx.raffleId);
    expectOk(await lockRaffle(seedEx.raffleId));

    // Post-lock direct deletion shrinks the pool below the allocation — the
    // scenario lock validation should have made impossible.
    // Ticket/IDs are text (D-E29): name the survivor explicitly rather than
    // relying on an ordering comparison.
    await db.entry.deleteMany({
      where: { raffleId: seedEx.raffleId, ticketNumber: { notIn: ["1"] } },
    });

    const error = expectFail(await executeRound(seedEx.rounds[0].id));
    expect(error).toBe(
      "Draw stopped: the eligible pool ran out during round 'Round 1'. No winners were committed for this round. This should have been prevented at lock — contact support."
    );
    expect(await drawEventsOf(seedEx.raffleId)).toHaveLength(0);
    expect(
      await db.auditLog.count({ where: { raffleId: seedEx.raffleId, action: "draw" } })
    ).toBe(0);
  });
});

describe("getEligiblePool (D-E01 semantics)", () => {
  it("excludes PENDING/CLAIMED/DISQUALIFIED winners; includes RELEASED_TO_POOL and never-drawn entrants", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-pool"),
      entrantCount: 5,
      rounds: [{ allocations: [{ prize: "A", quantity: 4 }] }],
    });
    tracker.track(seed.raffleId);
    const allocationId = seed.rounds[0].allocationIds[0];
    const [e1, e2, e3, e4, e5] = seed.entries;

    // Craft one DrawEvent per status directly; e5 has no events at all.
    await db.drawEvent.create({
      data: { roundAllocationId: allocationId, sequenceInAllocation: 1, winnerEntryId: e1.id, status: "PENDING" },
    });
    await db.drawEvent.create({
      data: { roundAllocationId: allocationId, sequenceInAllocation: 2, winnerEntryId: e2.id, status: "CLAIMED" },
    });
    await db.drawEvent.create({
      data: { roundAllocationId: allocationId, sequenceInAllocation: 3, winnerEntryId: e3.id, status: "RELEASED_TO_POOL" },
    });
    await db.drawEvent.create({
      data: { roundAllocationId: allocationId, sequenceInAllocation: 4, winnerEntryId: e4.id, status: "DISQUALIFIED" },
    });

    const pool = await getEligiblePool(db, seed.raffleId);
    expect(pool.map((p) => p.id).sort()).toEqual([e3.id, e5.id].sort());
  });
});

describe("concurrency backstop", () => {
  it("two concurrent executions of the same round commit exactly one set; the loser gets the already-drawn error", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-draw-race"),
      entrantCount: 4,
      rounds: [{ allocations: [{ prize: "A", quantity: 2 }] }],
    });
    tracker.track(seed.raffleId);
    expectOk(await lockRaffle(seed.raffleId));
    const roundId = seed.rounds[0].id;

    const [r1, r2] = await Promise.all([executeRound(roundId), executeRound(roundId)]);

    const results = [r1, r2];
    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0].ok ? "" : losses[0].error).toBe(ALREADY_DRAWN);

    // Exactly ONE committed set of DrawEvents (and matching audit rows).
    const events = await drawEventsOf(seed.raffleId);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.sequenceInAllocation).sort()).toEqual([1, 2]);
    expect(
      await db.auditLog.count({
        where: { raffleId: seed.raffleId, action: "draw", entityType: "draw_event" },
      })
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Live redraw — the draw screen's mid-show correction (src/actions/draw.ts
// redrawLiveSlot, sharing src/lib/redraw.ts with the winners screen).
// Eligibility differs deliberately: PENDING slot, raffle LOCKED or DRAWN.
// ---------------------------------------------------------------------------

const LIVE_INELIGIBLE =
  "Only a pending winner can be redrawn during the draw. Manage this slot from the Winners tab.";
const LIVE_SUPERSEDED =
  "This record has been superseded by a redraw and can no longer be changed.";
const LIVE_FROZEN =
  "This raffle has been completed. Winner records are frozen and can no longer be changed.";
const LIVE_POOL_EMPTY = "No eligible entrants remain for a redraw.";

describe("redrawLiveSlot", () => {
  it("replaces a PENDING slot mid-show: same slot identity, supersession, one 'redraw' audit, one draw-screen row", async () => {
    const seed = await seedLockedTwoRoundRaffle();
    const [round1] = seed.rounds;
    const drawn = expectOk(await executeRound(round1.id));
    const slot = drawn.slots[0];

    // Raffle is still LOCKED (round 2 undrawn) — the live path must work here.
    expect(
      (await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } })).status
    ).toBe("LOCKED");

    const result = expectOk(
      await redrawLiveSlot({ drawEventId: slot.drawEventId, reason: "  Not present  " })
    );

    expect(result.slotId).toBe(slot.slotId);
    expect(result.roundId).toBe(round1.id);
    expect(result.prizeLabel).toBe(slot.prizeLabel);
    expect(result.replacement.drawEventId).not.toBe(slot.drawEventId);
    expect(result.replacement.fullName).not.toBe(slot.winner.fullName);

    const original = await db.drawEvent.findUniqueOrThrow({
      where: { id: slot.drawEventId },
    });
    const replacement = await db.drawEvent.findUniqueOrThrow({
      where: { id: result.replacement.drawEventId },
    });

    // Original: superseded AND released back to the pool (live semantics).
    expect(original.supersededById).toBe(replacement.id);
    expect(original.status).toBe("RELEASED_TO_POOL");
    expect(original.winnerEntryId).not.toBe(replacement.winnerEntryId);
    // Replacement: same slot identity, fresh PENDING.
    expect(replacement.roundAllocationId).toBe(original.roundAllocationId);
    expect(replacement.sequenceInAllocation).toBe(original.sequenceInAllocation);
    expect(replacement.status).toBe("PENDING");
    expect(replacement.supersededById).toBeNull();

    // Exactly one redraw audit entry, reason trimmed, chain reconstructible.
    const redrawAudits = (await auditRowsOf(seed.raffleId)).filter(
      (a) => a.action === "redraw"
    );
    expect(redrawAudits).toHaveLength(1);
    expect(redrawAudits[0].drawEventId).toBe(replacement.id);
    expect(redrawAudits[0].reason).toBe("Not present");
    expect(redrawAudits[0].oldValue).toMatchObject({
      supersededFrom: original.id,
      previousWinner: original.winnerEntryId,
    });
    expect(redrawAudits[0].newValue).toMatchObject({
      winnerEntryId: replacement.winnerEntryId,
      previousWinnerStatus: "RELEASED_TO_POOL",
    });

    // The draw screen shows ONE row for the slot — the replacement.
    const screen = await getDrawScreenState(seed.raffleId);
    const r1 = screen!.rounds.find((r) => r.id === round1.id)!;
    expect(r1.slots).toHaveLength(1);
    expect(r1.slots[0].slotId).toBe(slot.slotId);
    expect(r1.slots[0].drawEventId).toBe(replacement.id);
    expect(r1.slots[0].winner.fullName).toBe(result.replacement.fullName);

    // The replaced entrant is back in the eligible pool for later rounds and
    // later redraws (D-E01: RELEASED_TO_POOL does not exclude); the new winner
    // is out of it. The replacement was picked BEFORE the release, so it can
    // never be the released entrant.
    const pool = await getEligiblePool(db, seed.raffleId);
    expect(pool.map((p) => p.id)).toContain(original.winnerEntryId);
    expect(pool.map((p) => p.id)).not.toContain(replacement.winnerEntryId);

    // The superseded record is not redrawable again.
    expect(
      expectFail(await redrawLiveSlot({ drawEventId: original.id, reason: "again" }))
    ).toBe(LIVE_SUPERSEDED);
  });

  it("refuses a non-PENDING slot and requires a reason, with zero writes", async () => {
    const seed = await seedLockedTwoRoundRaffle();
    const drawn = expectOk(await executeRound(seed.rounds[0].id));
    const slot = drawn.slots[0];

    expect(
      expectFail(await redrawLiveSlot({ drawEventId: slot.drawEventId, reason: "   " }))
    ).toBe("A reason is required for every status change.");

    await db.drawEvent.update({
      where: { id: slot.drawEventId },
      data: { status: "CLAIMED" },
    });
    expect(
      expectFail(await redrawLiveSlot({ drawEventId: slot.drawEventId, reason: "why" }))
    ).toBe(LIVE_INELIGIBLE);

    expect(await drawEventsOf(seed.raffleId)).toHaveLength(1);
    expect(
      await db.auditLog.count({ where: { raffleId: seed.raffleId, action: "redraw" } })
    ).toBe(0);
  });

  it("works once the raffle is DRAWN and is frozen at COMPLETED (D-E18)", async () => {
    const seed = await seedLockedTwoRoundRaffle();
    expectOk(await executeRound(seed.rounds[0].id));
    const round2 = expectOk(await executeRound(seed.rounds[1].id));
    expect(round2.raffleDrawn).toBe(true);

    const target = round2.slots[0];
    const result = expectOk(
      await redrawLiveSlot({ drawEventId: target.drawEventId, reason: "declined" })
    );
    expect(result.slotId).toBe(target.slotId);

    expectOk(await transitionRaffleStatus(seed.raffleId, "COMPLETED"));
    expect(
      expectFail(
        await redrawLiveSlot({
          drawEventId: result.replacement.drawEventId,
          reason: "too late",
        })
      )
    ).toBe(LIVE_FROZEN);
  });

  it("refuses when the pool is empty, with zero writes", async () => {
    // 2 entrants, 2 slots in one round -> the pool is empty after the draw.
    const seed = await seedStructure({
      title: uniqueTitle("it-live-redraw-pool"),
      entrantCount: 2,
      rounds: [{ allocations: [{ prize: "A", quantity: 2 }] }],
    });
    tracker.track(seed.raffleId);
    expectOk(await lockRaffle(seed.raffleId));
    const drawn = expectOk(await executeRound(seed.rounds[0].id));

    expect(
      expectFail(
        await redrawLiveSlot({
          drawEventId: drawn.slots[0].drawEventId,
          reason: "no one left",
        })
      )
    ).toBe(LIVE_POOL_EMPTY);

    expect(await drawEventsOf(seed.raffleId)).toHaveLength(2);
    expect(
      await db.auditLog.count({ where: { raffleId: seed.raffleId, action: "redraw" } })
    ).toBe(0);
  });
});
