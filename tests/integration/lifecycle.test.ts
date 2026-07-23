// Integration: raffle lifecycle + prize types (src/actions/raffles.ts,
// src/actions/prize-types.ts) against the real Neon database.

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

import { createRaffle, updateRaffle, transitionRaffleStatus } from "@/actions/raffles";
import { addPrizeType, deletePrizeType } from "@/actions/prize-types";
import { db } from "@/lib/db";
import {
  raffleTracker,
  uniqueTitle,
  expectOk,
  expectFail,
  auditRowsOf,
} from "./helpers";

const tracker = raffleTracker();
afterAll(() => tracker.cleanup());

async function newRaffle(prefix = "it-life") {
  const title = uniqueTitle(prefix);
  const { id } = expectOk(await createRaffle({ title }), "createRaffle");
  tracker.track(id);
  return { id, title };
}

describe("createRaffle / updateRaffle", () => {
  it("creates a raffle in status DRAFT", async () => {
    const { id, title } = await newRaffle();
    const row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("DRAFT");
    expect(row.title).toBe(title);
    expect(row.description).toBeNull();
  });

  it("updates title/description while DRAFT and while OPEN", async () => {
    const { id } = await newRaffle();

    const draftTitle = uniqueTitle("it-life-draft");
    expectOk(await updateRaffle(id, { title: draftTitle, description: "d1" }));
    let row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe(draftTitle);
    expect(row.description).toBe("d1");

    expectOk(await transitionRaffleStatus(id, "OPEN"));
    const openTitle = uniqueTitle("it-life-open");
    expectOk(await updateRaffle(id, { title: openTitle }));
    row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("OPEN");
    expect(row.title).toBe(openTitle);
  });

  it("rejects updateRaffle once the raffle is LOCKED, leaving the title unchanged", async () => {
    const { id, title } = await newRaffle();
    await db.raffle.update({ where: { id }, data: { status: "LOCKED" } });

    const error = expectFail(await updateRaffle(id, { title: uniqueTitle("nope") }));
    expect(error).toBe("This raffle is locked. Its details can no longer be edited.");

    const row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe(title);
  });
});

describe("transitionRaffleStatus", () => {
  it("DRAFT -> OPEN writes exactly one audit entry with action 'open' and old/new status", async () => {
    const { id } = await newRaffle();

    const data = expectOk(await transitionRaffleStatus(id, "OPEN"));
    expect(data.status).toBe("OPEN");

    const row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("OPEN");

    const audits = await auditRowsOf(id);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("open");
    expect(audits[0].entityType).toBe("raffle");
    expect(audits[0].entityId).toBe(id);
    expect(audits[0].oldValue).toEqual({ status: "DRAFT" });
    expect(audits[0].newValue).toEqual({ status: "OPEN" });
  });

  it("rejects the illegal DRAFT -> DRAWN transition with status unchanged and zero audit entries", async () => {
    const { id } = await newRaffle();

    const error = expectFail(await transitionRaffleStatus(id, "DRAWN"));
    expect(error).toBe("This raffle cannot move from draft to drawn.");

    const row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("DRAFT");
    expect(await auditRowsOf(id)).toHaveLength(0);
  });

  it("rejects the backward LOCKED -> OPEN transition", async () => {
    const { id } = await newRaffle();
    await db.raffle.update({ where: { id }, data: { status: "LOCKED" } });

    const error = expectFail(await transitionRaffleStatus(id, "OPEN"));
    expect(error).toBe("This raffle cannot move from locked to open.");

    const row = await db.raffle.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("LOCKED");
    expect(await auditRowsOf(id)).toHaveLength(0);
  });
});

describe("prize types", () => {
  it("adds a prize type and rejects a case-insensitive duplicate", async () => {
    const { id } = await newRaffle();

    const created = expectOk(await addPrizeType(id, { name: "Gold Prize" }));
    const row = await db.prizeType.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.name).toBe("Gold Prize");
    expect(row.raffleId).toBe(id);

    const error = expectFail(await addPrizeType(id, { name: "  gOLD pRIZE  " }));
    expect(error).toBe("A prize type with this name already exists.");
    expect(await db.prizeType.count({ where: { raffleId: id } })).toBe(1);
  });

  it("deletes an unallocated prize type immediately", async () => {
    const { id } = await newRaffle();
    const created = expectOk(await addPrizeType(id, { name: "Silver" }));

    const data = expectOk(await deletePrizeType(created.id, false));
    expect(data).toEqual({ requiresConfirmation: false, allocationCount: 0 });
    expect(await db.prizeType.count({ where: { id: created.id } })).toBe(0);
  });

  it("refuses to delete an allocated prize type without confirmedCascade, deleting nothing", async () => {
    const { id } = await newRaffle();
    const created = expectOk(await addPrizeType(id, { name: "Bronze" }));
    const round = await db.drawRound.create({
      data: { raffleId: id, order: 1, label: "Round 1" },
    });
    const alloc = await db.roundAllocation.create({
      data: { roundId: round.id, prizeTypeId: created.id, quantity: 2 },
    });

    const data = expectOk(await deletePrizeType(created.id, false));
    expect(data).toEqual({ requiresConfirmation: true, allocationCount: 1 });

    // Nothing was deleted.
    expect(await db.prizeType.count({ where: { id: created.id } })).toBe(1);
    expect(await db.roundAllocation.count({ where: { id: alloc.id } })).toBe(1);
  });

  it("deletes prize type and its allocations atomically when confirmed", async () => {
    const { id } = await newRaffle();
    const created = expectOk(await addPrizeType(id, { name: "Platinum" }));
    const round = await db.drawRound.create({
      data: { raffleId: id, order: 1, label: "Round 1" },
    });
    await db.roundAllocation.create({
      data: { roundId: round.id, prizeTypeId: created.id, quantity: 1 },
    });
    await db.roundAllocation.create({
      data: { roundId: round.id, prizeTypeId: created.id, quantity: 3 },
    });

    const data = expectOk(await deletePrizeType(created.id, true));
    expect(data.requiresConfirmation).toBe(false);

    expect(await db.prizeType.count({ where: { id: created.id } })).toBe(0);
    expect(
      await db.roundAllocation.count({ where: { prizeTypeId: created.id } })
    ).toBe(0);
  });

  it("rejects prize type mutation on a LOCKED raffle", async () => {
    const { id } = await newRaffle();
    const created = expectOk(await addPrizeType(id, { name: "Keeper" }));
    await db.raffle.update({ where: { id }, data: { status: "LOCKED" } });

    const addError = expectFail(await addPrizeType(id, { name: "New One" }));
    expect(addError).toBe("This raffle is locked. Prize types can no longer be changed.");

    const delError = expectFail(await deletePrizeType(created.id, true));
    expect(delError).toBe("This raffle is locked. Prize types can no longer be changed.");

    expect(await db.prizeType.count({ where: { raffleId: id } })).toBe(1);
  });
});
