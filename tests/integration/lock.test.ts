// Integration: lock validation (src/actions/lock.ts + src/lib/allocation.ts)
// against the real Neon database — boundary math, exact refusal strings,
// counter/validator consistency (E1-03 NFR), post-lock immutability (epic AC4).

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

import { lockRaffle } from "@/actions/lock";
import { updateRaffle } from "@/actions/raffles";
import { addPrizeType } from "@/actions/prize-types";
import { createRound } from "@/actions/rounds";
import { createAllocation } from "@/actions/allocations";
import { addEntrant, removeEntrant } from "@/actions/entrants";
import { getAllocationSummary } from "@/lib/allocation";
import { db } from "@/lib/db";
import {
  raffleTracker,
  uniqueTitle,
  expectOk,
  expectFail,
  seedStructure,
  auditRowsOf,
} from "./helpers";

const tracker = raffleTracker();
afterAll(() => tracker.cleanup());

describe("lockRaffle validation", () => {
  it("locks when totalPlanned < entryCount, writing exactly one 'lock' audit entry", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-lock-under"),
      entrantCount: 3,
      rounds: [{ allocations: [{ prize: "A", quantity: 2 }] }],
    });
    tracker.track(seed.raffleId);

    expectOk(await lockRaffle(seed.raffleId));

    const raffle = await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } });
    expect(raffle.status).toBe("LOCKED");

    const audits = await auditRowsOf(seed.raffleId);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("lock");
    expect(audits[0].entityType).toBe("raffle");
    expect(audits[0].oldValue).toEqual({ status: "DRAFT" });
    expect(audits[0].newValue).toEqual({ status: "LOCKED" });
  });

  it("locks at the exact boundary totalPlanned == entryCount", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-lock-eq"),
      entrantCount: 3,
      rounds: [{ allocations: [{ prize: "A", quantity: 3 }] }],
    });
    tracker.track(seed.raffleId);

    expectOk(await lockRaffle(seed.raffleId));
    const raffle = await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } });
    expect(raffle.status).toBe("LOCKED");
  });

  it("refuses over-allocation with the exact server-computed message and leaves status unchanged", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-lock-over"),
      entrantCount: 3,
      rounds: [
        { allocations: [{ prize: "A", quantity: 2 }] },
        { allocations: [{ prize: "B", quantity: 3 }] },
      ],
    });
    tracker.track(seed.raffleId);

    const error = expectFail(await lockRaffle(seed.raffleId));
    expect(error).toBe(
      "This raffle plans 5 draws across all rounds but only has 3 entrants. Reduce allocations or add entrants before locking."
    );

    const raffle = await db.raffle.findUniqueOrThrow({ where: { id: seed.raffleId } });
    expect(raffle.status).toBe("DRAFT");
    expect(await auditRowsOf(seed.raffleId)).toHaveLength(0);
  });

  it("refuses zero rounds and zero planned draws", async () => {
    const noRounds = await seedStructure({
      title: uniqueTitle("it-lock-norounds"),
      entrantCount: 2,
    });
    tracker.track(noRounds.raffleId);
    expect(expectFail(await lockRaffle(noRounds.raffleId))).toBe(
      "Add at least one round with a prize allocation before locking."
    );
    expect(
      (await db.raffle.findUniqueOrThrow({ where: { id: noRounds.raffleId } })).status
    ).toBe("DRAFT");

    // A round exists but carries no allocation -> totalPlanned 0 -> same refusal.
    const emptyRound = await seedStructure({
      title: uniqueTitle("it-lock-zeroplan"),
      entrantCount: 2,
      rounds: [{ allocations: [] }],
    });
    tracker.track(emptyRound.raffleId);
    expect(expectFail(await lockRaffle(emptyRound.raffleId))).toBe(
      "Add at least one round with a prize allocation before locking."
    );
  });

  it("refuses to lock an already-locked raffle", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-lock-twice"),
      entrantCount: 2,
      rounds: [{ allocations: [{ prize: "A", quantity: 1 }] }],
    });
    tracker.track(seed.raffleId);

    expectOk(await lockRaffle(seed.raffleId));
    expect(expectFail(await lockRaffle(seed.raffleId))).toBe(
      "This raffle is already locked."
    );
    // Still exactly one lock audit entry.
    const audits = await auditRowsOf(seed.raffleId);
    expect(audits.filter((a) => a.action === "lock")).toHaveLength(1);
  });

  it("getAllocationSummary reports the same numbers the lock validator enforces", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-lock-summary"),
      entrantCount: 4,
      rounds: [
        { allocations: [{ prize: "A", quantity: 3 }, { prize: "B", quantity: 4 }] },
        { allocations: [{ prize: "A", quantity: 2 }] },
      ],
    });
    tracker.track(seed.raffleId);

    const summary = await getAllocationSummary(db, seed.raffleId);
    expect(summary).toEqual({ totalPlanned: 9, entryCount: 4 });

    // The lock refusal message must be built from EXACTLY these numbers.
    const error = expectFail(await lockRaffle(seed.raffleId));
    expect(error).toBe(
      `This raffle plans ${summary.totalPlanned} draws across all rounds but only has ${summary.entryCount} entrants. Reduce allocations or add entrants before locking.`
    );
  });
});

describe("post-lock structural immutability (epic AC4)", () => {
  it("rejects every structural mutation after lock", async () => {
    const seed = await seedStructure({
      title: uniqueTitle("it-lock-frozen"),
      entrantCount: 3,
      rounds: [{ allocations: [{ prize: "A", quantity: 1 }] }],
    });
    tracker.track(seed.raffleId);
    expectOk(await lockRaffle(seed.raffleId));

    expect(
      expectFail(await updateRaffle(seed.raffleId, { title: uniqueTitle("x") }))
    ).toBe("This raffle is locked. Its details can no longer be edited.");

    expect(expectFail(await addPrizeType(seed.raffleId, { name: "Late Prize" }))).toBe(
      "This raffle is locked. Prize types can no longer be changed."
    );

    expect(expectFail(await createRound(seed.raffleId))).toBe(
      "This raffle is locked. Rounds and allocations can no longer be changed."
    );

    expect(
      expectFail(
        await createAllocation(seed.rounds[0].id, {
          prizeTypeId: seed.prizeTypes["A"],
          quantity: 1,
        })
      )
    ).toBe("This raffle is locked. Rounds and allocations can no longer be changed.");

    expect(
      expectFail(await addEntrant(seed.raffleId, { ticketNumber: "99", fullName: "Late" }))
    ).toBe("This raffle is locked. Entrants can no longer be added.");

    expect(expectFail(await removeEntrant(seed.entries[0].id))).toBe(
      "This raffle is locked. Entrants can no longer be removed."
    );

    // Structure is untouched.
    expect(await db.entry.count({ where: { raffleId: seed.raffleId } })).toBe(3);
    expect(await db.drawRound.count({ where: { raffleId: seed.raffleId } })).toBe(1);
    expect(await db.prizeType.count({ where: { raffleId: seed.raffleId } })).toBe(1);
    expect(
      await db.roundAllocation.count({ where: { round: { raffleId: seed.raffleId } } })
    ).toBe(1);
  });
});
